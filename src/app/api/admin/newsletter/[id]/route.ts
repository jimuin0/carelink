import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { Resend } from 'resend';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { escSubject } from '@/lib/email';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { newsletterUnsubUrl } from '@/lib/newsletter-unsub';
import { fetchAllPaged } from '@/lib/paginate';
import { requirePlatformAdmin } from '@/lib/platform-admin';

// ニュースレター専用の差出人。EMAIL_FROM(email.ts の既定送信元 noreply@)とは意図的に
// ローカル部を分けている（購読解除等の応答性を示す newsletter@）ため EMAIL_FROM を
// 流用せず、専用の環境変数で本番ドメイン変更に追従できるようにする（未設定時は
// 従来のハードコード値と同じ既定値にフォールバックし後方互換を維持）。
const NEWSLETTER_FROM = process.env.NEWSLETTER_EMAIL_FROM || 'CareLink <newsletter@carelink-jp.com>';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 5, 60_000 * 10, 'newsletter-send')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const user = await requirePlatformAdmin();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { action } = await req.json().catch(() => ({}));
  const admin = createServiceRoleClient();

  const { data: campaign, error: fetchErr } = await admin
    .from('newsletter_campaigns')
    .select('*')
    .eq('id', params.id)
    .single();

  if (fetchErr || !campaign) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (action === 'cancel') {
    if (campaign.status !== 'scheduled') {
      return NextResponse.json({ error: 'Only scheduled campaigns can be cancelled' }, { status: 400 });
    }
    // 直前の fetch とこの update の間の TOCTOU（他リクエストが先に状態を変更 / 削除）で
    // 0件更新になっても、従来は .single() が PGRST116 を投げ 500 に丸められていた
    // （phantom success ではないが誤ったステータスコード）。status='scheduled' を
    // update 自体の WHERE 条件にも入れて楽観的並行制御にし、.select() で行数を検証、
    // 0件は「状態変化による競合」として 409 を返す（send の claim と同型）。
    const { data: updated, error: cancelErr } = await admin
      .from('newsletter_campaigns')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('status', 'scheduled')
      .select();
    if (cancelErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'キャンペーンの状態が変更されているため取り消せません' }, { status: 409 });
    }
    return NextResponse.json({ campaign: updated[0] });
  }

  if (action === 'schedule') {
    if (campaign.status !== 'draft') {
      return NextResponse.json({ error: 'Only draft campaigns can be scheduled' }, { status: 400 });
    }
    // cancel と同型: TOCTOU による0件更新を、楽観的並行制御(status='draft'をWHEREに追加)＋
    // 行数検証で 409 に正しく分類する（従来は .single() が0件で 500 に丸めていた）。
    const { data: updated, error: scheduleErr } = await admin
      .from('newsletter_campaigns')
      .update({ status: 'scheduled', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('status', 'draft')
      .select();
    if (scheduleErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'キャンペーンの状態が変更されているため予約できません' }, { status: 409 });
    }
    return NextResponse.json({ campaign: updated[0] });
  }

  if (action === 'send') {
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      return NextResponse.json({ error: 'Cannot send campaign in current status' }, { status: 400 });
    }

    // Atomically claim the send slot: only update if status is still draft/scheduled.
    // This prevents double-sends if two requests race through the status check above.
    const { data: claimed } = await admin
      .from('newsletter_campaigns')
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .in('status', ['draft', 'scheduled'])
      .select('id');

    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ error: 'Campaign is already being sent or has been sent' }, { status: 409 });
    }

    // claim（status='sending'）後のこの一連の処理は、途中で予期しない例外が起きると
    // キャンペーンが 'sending' に固着し、cancel（scheduled 限定）・schedule（draft 限定）
    // ・send（draft/scheduled 限定）のいずれからも復旧できなくなる恒久デッドロックだった
    // （実バグ）。全体を try/catch で包み、claim 後のどの段階で失敗しても必ず 'draft' へ
    // ロールバックする（再送・キャンセルが可能な状態に戻す）。
    try {
      // RESEND_API_KEY 未設定を明示的に事前ガードする。従来は new Resend(undefined) が
      // batch.send() で例外を投げ、それを catch → 全件 bounced 計上 → それでも
      // status='sent' に確定していた（実際には1通も届いていないのに送信済み扱いになり
      // 再送不可＝fail-open だった実バグ）。未設定なら送信を試みず 503 で明確に止める。
      if (!process.env.RESEND_API_KEY) {
        console.error('[newsletter/send] RESEND_API_KEY not configured — aborting send', { campaignId: params.id });
        await admin.from('newsletter_campaigns').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', params.id);
        return NextResponse.json({ error: 'メール送信設定(RESEND_API_KEY)が未完了のため送信を中止しました' }, { status: 503 });
      }

      // Determine subscription_type filter
      const subType = campaign.campaign_type === 'owner_monthly' ? 'owner_monthly' : 'user_digest';

      // Get subscribers（全件・PostgREST 1000行上限で受信者を無音に取りこぼさないよう分頁取得。監査M4）
      // 【監査M4・敵対検証】.order('id') 必須：ORDER BY 無しの OFFSET ページングは行順が不定で、
      // >1000行＋並行 unsubscribe/プラン差で【ページ境界の行欠落・重複】が起き得る（suppression 側は
      // 欠落＝停止済みへの誤送信に直結）。主キー id で決定的順序にする（booking-reminder と同方針）。
      const { rows: subscribers, error: subscribersErr } = await fetchAllPaged<{ email: string | null; user_id: string | null }>(
        async (offset, limit) => {
          const { data, error } = await admin
            .from('newsletter_subscriptions')
            .select('email, user_id')
            .or(`subscription_type.eq.${subType},subscription_type.eq.all`)
            .eq('is_active', true)
            .order('id', { ascending: true })
            .range(offset, offset + limit - 1);
          return { data, error };
        },
      );
      // 【監査M4・敵対検証】user_digest では subscribers が唯一の受信者源。取得失敗を握り潰すと
      // rows=[] で「0件送信→status='sent'確定」となりキャンペーンを空焼き（再送不可）してしまう。
      // suppression と同格に fail-safe で中止（draft へ戻す）。
      if (subscribersErr) {
        console.error('[newsletter/send] subscribers fetch failed — aborting to avoid phantom empty send', { campaignId: params.id, err: subscribersErr });
        await admin.from('newsletter_campaigns').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', params.id);
        return NextResponse.json({ error: '受信者リストの取得に失敗したため送信を中止しました' }, { status: 500 });
      }

      // For owner_monthly: also pull facility owner emails if no subscription record
      let emails: string[] = [];
      if (campaign.campaign_type === 'owner_monthly') {
        // profiles(email) を embed しない：facility_members.user_id は auth.users(id) 参照で
        // facility_members→profiles の FK が無く、PostgREST が関係を解決できず常時エラーになり
        // owner_monthly のオーナー宛メールが全スキップされる実バグになる（user-packages と同根）。
        // owner の user_id を取得し profiles を別取得してメールを引く（best-effort・失敗はログのみで続行）。
        const { rows: owners, error: ownersErr } = await fetchAllPaged<{ user_id: string | null }>(
          async (offset, limit) => {
            const { data, error } = await admin
              .from('facility_members')
              .select('user_id')
              .eq('role', 'owner')
              .order('id', { ascending: true }) // 監査M4：決定的順序で分頁の欠落・重複を防ぐ
              .range(offset, offset + limit - 1);
            return { data, error };
          },
        );
        if (ownersErr) console.error('[newsletter/send] owner email fetch failed — some owners may be skipped', { campaignId: params.id, err: ownersErr });
        const ownerUserIds = Array.from(new Set(owners.map((o) => o.user_id).filter(Boolean) as string[]));
        const ownerEmails: string[] = [];
        // profiles を id チャンク(500)で引く。ownerUserIds が 1000 を超えると単一 .in が
        // PostgREST 1000行上限/URL 長で取りこぼす（監査M4）。
        const OWNER_ID_CHUNK = 500;
        for (let i = 0; i < ownerUserIds.length; i += OWNER_ID_CHUNK) {
          const idChunk = ownerUserIds.slice(i, i + OWNER_ID_CHUNK);
          const { data: ownerProfiles, error: ownerProfErr } = await admin
            .from('profiles')
            .select('email')
            .in('id', idChunk);
          if (ownerProfErr) {
            console.error('[newsletter/send] owner profiles fetch failed — some owners may be skipped', { campaignId: params.id, err: ownerProfErr });
            continue;
          }
          ownerEmails.push(...((ownerProfiles || []).map((p: { email: string | null }) => p.email).filter(Boolean) as string[]));
        }
        // subscribers/unsubProfiles/inactiveSubs は fetchAllPaged の rows（型は T[]・常に配列）の
        // ため `|| []` は型レベルで到達不能（デッド分岐）。付けない。
        emails = Array.from(new Set([
          ...subscribers.map((s: { email: string | null }) => s.email).filter(Boolean) as string[],
          ...ownerEmails,
        ]));
      } else {
        emails = subscribers.map((s: { email: string | null }) => s.email).filter(Boolean) as string[];
      }

      // 配信停止の一次ソースは profiles.email_unsubscribed（アカウント有無に依存しない唯一の
      // 真実源。/api/unsubscribe の方式A(トークン)は newsletter_subscriptions を更新せず
      // profiles のみ更新するため、newsletter_subscriptions.is_active フィルタだけでは
      // 停止済みユーザーへの送信を防げない）。owner_monthly の ownerEmails は
      // newsletter_subscriptions を一切経由しないため、これが唯一の除外手段でもある。
      // 送信直前に両テーブルを必ず突合し、どちらかで停止済みなら除外する（fail-safe：
      // 取得失敗時は空集合扱いにせず処理を中断し、停止済みへの誤送信を防ぐ）。
      // メールは大小文字表記揺れを吸収するため小文字で突合する（例: unsubscribeByEmail 側も
      // toLowerCase 済み・大小文字違いの二重登録による停止漏れを防ぐ）。
      emails = Array.from(new Set(emails.map((e) => e.toLowerCase())));
      if (emails.length > 0) {
        // 【監査M4】配信停止リストは PostgREST 1000行上限で無音打ち切りされると停止済みユーザーへ
        // 誤送信し得るため、必ず全件取得する（取得失敗は空集合扱いにせず送信を中止＝fail-safe）。
        // 【監査M4 low】suppression は「全件取得」が契約。failOnTruncation:true で maxRows 打ち切りを
        // error として受け取り、下の既存 fail-safe 分岐で送信中止する（打ち切りを許すと停止済みが
        // suppression から漏れ opted-out へ誤送信する fail-open になる）。
        const { rows: unsubProfiles, error: unsubProfilesErr } = await fetchAllPaged<{ email: string | null }>(
          async (offset, limit) => {
            const { data, error } = await admin
              .from('profiles')
              .select('email')
              .not('email', 'is', null)
              .eq('email_unsubscribed', true)
              .order('id', { ascending: true }) // 監査M4：決定的順序で分頁のsuppression欠落を防ぐ
              .range(offset, offset + limit - 1);
            return { data, error };
          },
          { failOnTruncation: true },
        );
        if (unsubProfilesErr) {
          console.error('[newsletter/send] unsubscribed profiles fetch failed/truncated — aborting to avoid sending to opted-out users', { campaignId: params.id, err: unsubProfilesErr });
          await admin.from('newsletter_campaigns').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', params.id);
          return NextResponse.json({ error: '配信停止者リストの取得に失敗したため送信を中止しました' }, { status: 500 });
        }
        const { rows: inactiveSubs, error: inactiveSubsErr } = await fetchAllPaged<{ email: string | null }>(
          async (offset, limit) => {
            const { data, error } = await admin
              .from('newsletter_subscriptions')
              .select('email')
              .not('email', 'is', null)
              .eq('is_active', false)
              .order('id', { ascending: true }) // 監査M4：決定的順序で分頁のsuppression欠落を防ぐ
              .range(offset, offset + limit - 1);
            return { data, error };
          },
          { failOnTruncation: true },
        );
        if (inactiveSubsErr) {
          console.error('[newsletter/send] inactive subscriptions fetch failed/truncated — aborting to avoid sending to opted-out users', { campaignId: params.id, err: inactiveSubsErr });
          await admin.from('newsletter_campaigns').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', params.id);
          return NextResponse.json({ error: '配信停止者リストの取得に失敗したため送信を中止しました' }, { status: 500 });
        }
        // unsubProfiles/inactiveSubs は fetchAllPaged の rows（常に配列）のため `|| []` は付けない。
        const unsubscribed = new Set<string>([
          ...unsubProfiles.map((p: { email: string | null }) => (p.email ?? '').toLowerCase()).filter(Boolean),
          ...inactiveSubs.map((s: { email: string | null }) => (s.email ?? '').toLowerCase()).filter(Boolean),
        ]);
        emails = emails.filter((e) => !unsubscribed.has(e));
      }

      const resend = new Resend(process.env.RESEND_API_KEY);
      let sentCount = 0;
      let bouncedCount = 0;

      // Send individually (personalized unsubscribe URL per recipient).
      // Use resend.batch.send() in chunks of 100 (Resend batch limit).
      const BATCH_SIZE = 100;
      const subject = escSubject(campaign.subject);
      for (let i = 0; i < emails.length; i += BATCH_SIZE) {
        const chunk = emails.slice(i, i + BATCH_SIZE);
        const messages = chunk.map((email) => ({
          from: NEWSLETTER_FROM,
          to: [email],
          subject,
          html: campaign.html_content + `<br><br><hr><p style="font-size:11px;color:#999">配信停止は<a href="${newsletterUnsubUrl(email)}">こちら</a></p>`,
          text: campaign.text_content || undefined,
        }));
        try {
          await resend.batch.send(messages);
          sentCount += chunk.length;
        } catch (e) {
          console.error('[newsletter/send] batch chunk failed', { campaignId: params.id, chunkStart: i, chunkSize: chunk.length, err: e });
          bouncedCount += chunk.length;
        }
      }

      // 送信は既に完了している。ここで status='sent' への確定が失敗すると:
      //  - 旧実装は error を握り潰し 200 + campaign:null を返し、status は 'sending' に固着 →
      //    cancel/schedule/send のどの action からも復旧できない恒久デッドロック(実バグ)。
      //  - かといって catch の 'draft' ロールバックに落とすと、送信済みなのに再送可能になり
      //    二重送信を招く（絶対に避ける）。
      // よって error を検証し、'draft' へは戻さず sent 確定をもう一度だけ試みる。それも失敗したら
      // LOUD にログし 500 を返す（status='sending' のまま人手対応・二重送信は起こさない）。
      const finalizeSent = () => admin
        .from('newsletter_campaigns')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          // opened/clicked は開封・クリック計測(Resend webhook 等)が未実装のため常に 0 固定。
          // 実測ではなく「未計測」を意味する値であることを明記する（実装済みと誤認させない）。
          stats: { sent: sentCount, opened: 0, clicked: 0, bounced: bouncedCount },
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.id)
        .select()
        .single();

      let { data: updated, error: finalizeErr } = await finalizeSent();
      if (finalizeErr) {
        console.error('[newsletter/send] CRITICAL: emails sent but status finalize failed — retrying (NOT rolling back to avoid double-send)', { campaignId: params.id, sentCount, bouncedCount, err: finalizeErr });
        ({ data: updated, error: finalizeErr } = await finalizeSent());
        if (finalizeErr) {
          console.error('[newsletter/send] CRITICAL: status finalize retry also failed — campaign stuck in sending, manual fix required', { campaignId: params.id, sentCount, bouncedCount, err: finalizeErr });
          return NextResponse.json(
            { error: 'メールは送信されましたが、送信状態の記録に失敗しました。管理者にご連絡ください。', sentCount, bouncedCount },
            { status: 500 },
          );
        }
      }

      const { ua } = getRequestContext(req);
      void writeAuditLog({
        userId: user.id,
        action: 'create',
        tableName: 'newsletter_campaigns',
        recordId: params.id,
        newValues: { action: 'send', campaign_type: campaign.campaign_type, subject: campaign.subject, sent_count: sentCount, bounced_count: bouncedCount },
        ipAddress: ip,
        userAgent: ua,
      });

      return NextResponse.json({ campaign: updated, sentCount, bouncedCount });
    } catch (e) {
      console.error('[newsletter/send] unexpected error during send — rolling back to draft', { campaignId: params.id, err: e });
      await admin.from('newsletter_campaigns').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', params.id);
      return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
