import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { alertWarning } from '@/lib/alert';
import {
  computeDrift,
  computeConstraintDrift,
  type SchemaRow,
  type ConstraintRow,
} from '@/lib/schema-drift';
import snapshot from '@/lib/schema-snapshot.json';
import constraintsSnapshot from '@/lib/schema-constraints-snapshot.json';
import { businessTypes } from '@/lib/constants';
import { fetchAllPaged } from '@/lib/paginate';

/** 古い claim 行の掃除しきい値（この期間より古い claim は削除対象）。 */
const CLAIM_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// 本番スキーマ(RPC get_public_columns)と期待スキーマ(schema-snapshot.json)を突合し、
// out-of-band な混入/欠落/列差分を発症前に Slack 通知する。読み取りのみ・副作用なし。
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const admin = createServiceRoleClient();
  const startedAt = new Date();

  const { data, error } = await admin.rpc('get_public_columns');
  if (error) {
    await logCronRun('schema-drift-check', 'error', startedAt, { error_msg: error.message });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  // RPC get_public_columns は jsonb 配列(1行)を返す。PostgREST 行数上限の影響を受けないよう
  // SETOF ではなく jsonb_agg で集約しているため data は [{table_name, column_name}] 配列そのもの。
  const rows = (Array.isArray(data) ? data : []) as SchemaRow[];
  const expected = snapshot as Record<string, string[]>;
  const { contaminated, missing, colDrift } = computeDrift(expected, rows);

  // 制約レベル（PK/UNIQUE）ドリフト。RPC get_public_constraints が未適用の環境では
  // graceful に skip し cron 本体を壊さない（本番 RPC 適用後に追加監視が自動で有効化）。
  let constraintExtra: string[] = [];
  let constraintMissing: string[] = [];
  let constraintCheckSkipped = false;
  const { data: cData, error: cError } = await admin.rpc('get_public_constraints');
  if (cError) {
    // 制約(PK/UNIQUE)ドリフト監視そのものが機能停止する障害。従来は meta フラグに
    // 残すのみで無音だったため、RPC が恒久的に壊れても誰も気づけず監視が永久に
    // 無効化されたまま cron_logs は 'success' で緑を保ち続けていた。恒久検知として
    // Slack へ警報する（列レベルのドリフト監視 computeDrift は RPC 非依存で継続する）。
    constraintCheckSkipped = true;
    alertWarning(
      'schema-drift-check: get_public_constraints RPC 失敗（制約ドリフト監視が無効化）',
      { route: '/api/cron/schema-drift-check', extra: { errorMessage: cError.message } },
    );
  } else {
    const cRows = (Array.isArray(cData) ? cData : []) as ConstraintRow[];
    const cd = computeConstraintDrift(constraintsSnapshot as ConstraintRow[], cRows);
    constraintExtra = cd.extra;
    constraintMissing = cd.missing;
  }

  // 【2026年7月29日 追加・値ドリフト監視】
  // business_type は検索・カテゴリ導線・/type/* の結合キーだが、DB に CHECK 制約が無い。
  // 実際に本番で正規タクソノミー外の値（「まつげ・眉毛サロン」「hair_salon」）が保存され、
  // 施設は存在するのにトップのカテゴリタイル・悩みナビ・特集バナーが全て 0 件になり、
  // 掲載施設へ到達する導線が消えていた（誰も気づけない無音の断線）。
  // 保存の入口は塞いだが、DDL・手動投入・将来の別経路で再びズレうるため、
  // 列や制約と同じようにここで「値」のドリフトも見張る。
  let businessTypeDrift: string[] = [];
  // facility_profiles は PostgREST の db-max-rows(既定1000) 対象のテーブルセレクトのため、
  // 単純な .select() のままだと施設数が1000件を超えた時点で後半の行が無音で取りこぼされ、
  // それらの business_type にドリフトがあっても検知されなくなる（get_public_columns 等は
  // jsonb_agg の RPC で1行返しのためこの制限を受けないが、これは通常テーブルセレクト）。
  const { rows: btRows, error: btError, truncated: btTruncated } = await fetchAllPaged<{
    business_type: string | null;
  }>(async (offset, limit) => {
    const res = await admin
      .from('facility_profiles')
      .select('business_type')
      .range(offset, offset + limit - 1);
    return { data: res.data, error: res.error };
  });
  if (btError) {
    alertWarning(
      'schema-drift-check: business_type 取得失敗（業種タクソノミーのドリフト監視が無効化）',
      { route: '/api/cron/schema-drift-check', extra: { errorMessage: (btError as { message?: string }).message } },
    );
  } else {
    if (btTruncated) {
      // maxRows 上限での打ち切り＝一部施設が未チェックのまま監視結果が返る。無音にせず
      // 監視自体の信頼性低下として警報する（fail-safe：検知漏れの可能性を隠さない）。
      alertWarning(
        'schema-drift-check: business_type 取得が maxRows 上限で打ち切られた（一部施設が未チェック）',
        { route: '/api/cron/schema-drift-check', extra: { checkedCount: btRows.length } },
      );
    }
    businessTypeDrift = [
      ...new Set(
        btRows
          .map((r) => r.business_type)
          .filter((v): v is string => !!v)
          .filter((v) => !businessTypes.includes(v)),
      ),
    ];
  }

  // 【2026年7月29日 追加・口コミ真正性の値監視】
  // 本番 facility_reviews に、サイト経由でない口コミ13件が一括 INSERT され、
  // rating_avg 経由で公開ページに ★4.6〜4.8 として出ていた（うち3件は裏付けの無い
  // 「来店確認済み」バッジ付き）。投稿の唯一の入口 /api/review は reviewer_ip を必ず書き
  // （getClientIp は取得不能時も 'unknown' を返す）、is_verified_visit はログイン済みかつ
  // completed 予約がある場合しか true にしない。よって
  //   (a) reviewer_ip IS NULL、(b) is_verified_visit かつ user_id なし
  // は正規経路では原理的に発生せず、出現＝out-of-band な直接投入を意味する。
  // 入口は CHECK 制約（20260729000002）で塞ぐが、制約が外された場合・DDL 未適用の環境で
  // 無音にならないよう、値としてもここで見張る（列・制約と同じ扱い）。
  // count 指定の head クエリのため PostgREST の db-max-rows の影響を受けない。
  const reviewAuthenticityDrift: string[] = [];
  const [iplessRes, unbackedRes] = await Promise.all([
    admin.from('facility_reviews').select('id', { count: 'exact', head: true }).is('reviewer_ip', null),
    admin
      .from('facility_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('is_verified_visit', true)
      .is('user_id', null),
  ]);
  if (iplessRes.error || unbackedRes.error) {
    alertWarning('schema-drift-check: 口コミ真正性の取得失敗（サイト外投入の監視が無効化）', {
      route: '/api/cron/schema-drift-check',
      extra: {
        iplessError: iplessRes.error?.message ?? null,
        unbackedError: unbackedRes.error?.message ?? null,
      },
    });
  } else {
    if ((iplessRes.count ?? 0) > 0) {
      reviewAuthenticityDrift.push(`reviewer_ip欠落:${iplessRes.count}件`);
    }
    if ((unbackedRes.count ?? 0) > 0) {
      reviewAuthenticityDrift.push(`来店確認済みだがuser_id無し:${unbackedRes.count}件`);
    }
  }

  const driftCount =
    contaminated.length +
    missing.length +
    colDrift.length +
    constraintExtra.length +
    constraintMissing.length +
    businessTypeDrift.length +
    reviewAuthenticityDrift.length;

  // 【claim-first 設計・2026-07-17】
  // cron は三重化（GitHub Actions + pg_cron + Render）で同一スケジュール(JST 02:40)に
  // ほぼ同時発火するため、同一ドリフトに対して複数 run が同時に alertWarning を叩き、
  // Slack へ重複警報が飛んでいた。alertWarning はスレッド集約のみで送信自体は毎回行う
  // ため集約では防げない。事前 SELECT で確認してから送る方式は TOCTOU（確認後に別 run が
  // 割り込む余地がある）を再導入するため使わない。birthday-coupon / review-request と
  // 同型の claim-first：送信直前に (job_name, claim_key) を INSERT して「送信権」を claim し、
  // PRIMARY KEY 違反(23505)なら他 run が先取り済みとして送信をスキップする。
  // claim_key は「当日(UTC)＋drift内容の指紋」で構成するため、同日同内容の drift は1通だけ
  // 通知され、内容が変化すれば別キーとして再通知される。
  let alertDeduped = false;
  if (driftCount > 0) {
    // drift 内容の安定した指紋。computeDrift/computeConstraintDrift は結果を常にソート済みで
    // 返す純粋関数のため、同一ドリフトなら常に同じ JSON 文字列＝同じハッシュになる。
    const driftFingerprint = createHash('sha256')
      .update(JSON.stringify({ contaminated, missing, colDrift, constraintExtra, constraintMissing, businessTypeDrift, reviewAuthenticityDrift }))
      .digest('hex')
      .slice(0, 16);
    const claimDate = startedAt.toISOString().slice(0, 10); // UTC日付(YYYY-MM-DD)
    const claimKey = `${claimDate}:${driftFingerprint}`;

    const { error: claimError } = await admin.from('cron_alert_claims').insert({
      job_name: 'schema-drift-check',
      claim_key: claimKey,
    });

    let shouldAlert = true;
    if (claimError) {
      if ((claimError as { code?: string }).code === '23505') {
        // 他スケジューラが同日・同内容のドリフトを先に claim・通知済み。重複送信を避けてスキップ。
        shouldAlert = false;
        alertDeduped = true;
        console.log('[schema-drift-check] alert claim already taken (deduped)', { claimKey });
      } else {
        // claim 不能（migration 未適用の 42P01 含む）。fail-open：無音より重複の方が安全なため
        // 送信する。DDL 未適用期間はこの分岐に必ず落ち、claim 導入前と完全に同一の挙動になる
        // （デプロイ順序非依存）。
        console.warn('[schema-drift-check] alert claim insert failed (fail-open: sending anyway)', {
          claimKey,
          code: (claimError as { code?: string }).code,
          message: claimError.message,
        });
      }
    }

    if (shouldAlert) {
      alertWarning(
        `スキーマドリフト検知: 混入${contaminated.length} / 欠落${missing.length} / 列差分${colDrift.length} / 制約追加${constraintExtra.length} / 制約欠落${constraintMissing.length} / 業種値ドリフト${businessTypeDrift.length} / 口コミ真正性${reviewAuthenticityDrift.length}`,
        {
          route: '/api/cron/schema-drift-check',
          extra: { contaminated, missing, colDrift, constraintExtra, constraintMissing, businessTypeDrift, reviewAuthenticityDrift },
        },
      );
    }

    // 古い claim 行の掃除（保持期間超過分を削除）。best-effort・失敗しても本体は継続する
    // （テーブル肥大化の防止のみが目的で、失敗しても通知ロジックの正しさに影響しない）。
    // job_name を自ジョブに限定する：テーブルは (job_name, claim_key) 設計で将来他 cron と
    // 共有し得るため、無条件 delete だと他ジョブの claim 行を越境削除してしまう。
    const staleBefore = new Date(startedAt.getTime() - CLAIM_RETENTION_MS).toISOString();
    const { error: cleanupError } = await admin
      .from('cron_alert_claims')
      .delete()
      .eq('job_name', 'schema-drift-check')
      .lt('claimed_at', staleBefore);
    if (cleanupError) {
      console.warn('[schema-drift-check] stale alert claim cleanup failed (best-effort, ignored)', {
        code: (cleanupError as { code?: string }).code,
        message: cleanupError.message,
      });
    }
  }

  await logCronRun('schema-drift-check', 'success', startedAt, {
    processed: driftCount,
    meta: {
      contaminated,
      missing,
      colDrift,
      constraintExtra,
      constraintMissing,
      businessTypeDrift,
      reviewAuthenticityDrift,
      constraintCheckSkipped,
      alertDeduped,
    },
  });
  return NextResponse.json({
    ok: true,
    driftCount,
    contaminated,
    missing,
    colDrift,
    constraintExtra,
    constraintMissing,
    businessTypeDrift,
    reviewAuthenticityDrift,
    constraintCheckSkipped,
  });
}
