import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { alertWarning, alertError } from '@/lib/alert';
import {
  computeDrift,
  diffFingerprint,
  type SchemaRow,
} from '@/lib/schema-drift';
import snapshot from '@/lib/schema-snapshot.json';
import fingerprintExpected from '@/lib/schema-fingerprint.expected.json';
import { businessTypes } from '@/lib/constants';
import { fetchAllPaged } from '@/lib/paginate';
import type { Json } from '@/types/database.types';

// RPC get_public_columns は jsonb_agg で {table_name, column_name} の配列を1行で返す
// （PostgREST の行数上限を回避するための集約）。<Database> 型上は RPC の戻り値は Json
// （JSON リテラル null・配列・プリミティブも許容する合併型）なので、tsc は Json[] を
// SchemaRow[] へ直接みなすことを拒む（TS2352）。as で黙らせると、RPC の実装が将来変わって
// 想定外の形を返した場合に無音で誤判定される。想定形（table_name/column_name が共に
// string）であることを実行時に検証し、確認できた要素だけを新しい SchemaRow として組み直す
// （SchemaRow はインデックスシグネチャを持たないため Json のユーザー定義型ガードにはできず
// 「v is SchemaRow」は型として成立しない＝関数を分けて明示的に詰め替える）。
function toSchemaRow(v: Json): SchemaRow | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const { table_name, column_name } = v;
  if (typeof table_name !== 'string' || typeof column_name !== 'string') return null;
  return { table_name, column_name };
}

/** 古い claim 行の掃除しきい値（この期間より古い claim は削除対象）。 */
const CLAIM_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** claim-first の対象 severity。claim_key に埋め込み、🔴 と 🟡 を互いに独立して dedup する。 */
type ClaimSeverity = 'critical' | 'warning';

/**
 * 1 severity 分の claim-first 送信（三重化cronの同時発火による重複 Slack 警報を防止）。
 *
 * why: cron は GitHub Actions + pg_cron + Render の三重化でほぼ同時発火するため、
 * driftCount>0 のたびに無条件で送ると同一内容の警報が最大3通飛ぶ。送信直前に
 * (job_name, claim_key) を INSERT して「送信権」を claim し、PRIMARY KEY 違反(23505)
 * なら他 run が先取り済みとしてスキップする（birthday-coupon 等と同型・claim_key
 * ドキュメントは 20260717000004_cron_alert_claims.sql 参照）。
 *
 * claim_key に severity を含めるのは、🔴 driftMissing 系と 🟡 driftExtra 系が同一 run で
 * 同時に発生し得て、かつ独立に dedup されるべきため（🔴 が他 run に先取りされても
 * 🟡 は別 run が拾えるように、また逆も同様）。job_name は両 severity で共有するため、
 * 保持期限切れ claim の掃除（cleanup delete）は1回で両方をカバーする。
 *
 * when: claim insert が 23505 以外のエラー（例: migration 未適用の 42P01）で失敗した場合は
 * fail-open（無音より重複の方が安全）で送信する。
 *
 * @returns この severity の送信が dedup（スキップ）されたか。
 */
async function claimAndAlert(
  admin: ReturnType<typeof createServiceRoleClient>,
  startedAt: Date,
  severity: ClaimSeverity,
  fingerprintPayload: unknown,
  send: () => void,
): Promise<boolean> {
  const driftFingerprint = createHash('sha256')
    .update(JSON.stringify(fingerprintPayload))
    .digest('hex')
    .slice(0, 16);
  const claimDate = startedAt.toISOString().slice(0, 10); // UTC日付(YYYY-MM-DD)
  const claimKey = `${claimDate}:${severity}:${driftFingerprint}`;

  const { error: claimError } = await admin.from('cron_alert_claims').insert({
    job_name: 'schema-drift-check',
    claim_key: claimKey,
  });

  let deduped = false;
  let shouldAlert = true;
  if (claimError) {
    if ((claimError as { code?: string }).code === '23505') {
      // 他スケジューラが同日・同内容・同 severity のドリフトを先に claim・通知済み。
      shouldAlert = false;
      deduped = true;
      console.log('[schema-drift-check] alert claim already taken (deduped)', { claimKey, severity });
    } else {
      // claim 不能（migration 未適用の 42P01 含む）。fail-open：無音より重複の方が安全。
      console.warn('[schema-drift-check] alert claim insert failed (fail-open: sending anyway)', {
        claimKey,
        severity,
        code: (claimError as { code?: string }).code,
        message: claimError.message,
      });
    }
  }

  if (shouldAlert) {
    send();
  }

  return deduped;
}

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
  // 想定外の形の要素が混ざっていた場合は toSchemaRow が null を返し弾く（結果として
  // そのテーブルは本番に存在しない扱いになるが、これは既存の missing/contaminated
  // 検知の枠内で可視化される）。
  const rows = (Array.isArray(data) ? data : [])
    .map(toSchemaRow)
    .filter((r): r is SchemaRow => r !== null);
  const expected = snapshot as Record<string, string[]>;
  const { contaminated, missing, colDrift } = computeDrift(expected, rows);

  // ── スキーマ全面フィンガープリント突合（2026年8月2日・手管理スナップショットを廃止）──
  // 🔴 旧実装は src/lib/schema-constraints-snapshot.json を【人が手で更新する】前提で、
  //   pg_constraint の contype IN ('p','u') だけを見ていた。そのため
  //   (a) migration 20260722000005 が UNIQUE(facility_id,is_active) を意図的に DROP した際、
  //       JSON だけ取り残されて **毎日「制約欠落1」を誤報し続けていた**（誤報は検知の死）
  //   (b) FK / CHECK / インデックス（部分ユニーク含む）/ RLS ポリシー（実測131本＝施設間
  //       データ分離の実体）/ 列の型・NOT NULL・DEFAULT / トリガ / 関数本体 / enum / GRANT が
  //       **一切監視されていなかった**
  //   期待値は migration を使い捨て Postgres に全適用して生成する
  //   （scripts/gen-schema-fingerprint.sh）。人が触らないので陳腐化しない。
  //   CI が --check で「コミット済み期待値 == migration の結果」を強制する。
  let driftExtra: string[] = [];
  let driftMissing: string[] = [];
  let fingerprintCheckSkipped = false;
  const { data: fpData, error: fpError } = await admin.rpc('get_schema_fingerprint');
  if (fpError) {
    // 監視そのものが機能停止する障害。無音にすると「緑なのは正常だから」と
    // 読み替えられてしまうので、必ず鳴らす（列レベルの computeDrift は RPC 非依存で継続）。
    fingerprintCheckSkipped = true;
    alertWarning(
      'schema-drift-check: get_schema_fingerprint RPC 失敗（スキーマ全面監視が無効化）',
      { route: '/api/cron/schema-drift-check', extra: { errorMessage: fpError.message } },
    );
  } else {
    const actual = (Array.isArray(fpData) ? fpData : []) as string[];
    const fd = diffFingerprint(fingerprintExpected as string[], actual);
    driftExtra = fd.extra;
    driftMissing = fd.missing;
    if (fd.differentDatabase) {
      // 🔴 別 DB と突合している。差分は本番の異常ではなく比較対象の誤りなので、
      //   1 件も主張せず「監視が成立していない」として鳴らす。
      //   （2026年8月2日、CareLink の期待値を soel の本番と突合して
      //     「RLS が 90 本欠落」という存在しない事故を報告しかけた）
      fingerprintCheckSkipped = true;
      driftExtra = [];
      driftMissing = [];
      const dd = fd.differentDatabase;
      alertWarning(
        `schema-drift-check: 別のデータベースと突合している疑い（テーブル名の重なり ${(dd.overlap * 100).toFixed(0)}%）`,
        { route: '/api/cron/schema-drift-check', extra: dd },
      );
    } else if (fd.versionMismatch) {
      // 🔴 shadow(期待値の生成元)と本番の PostgreSQL メジャーバージョンが違う。
      //   pg_get_* の整形がメジャー間で変わり得るため、この状態で出る差分は
      //   「本番のドリフト」ではなく整形差のノイズ。1 件も主張せず、
      //   「監視が成立していない設定不備」として鳴らす（🔴 ではなく 🟡 相当）。
      fingerprintCheckSkipped = true;
      driftExtra = [];
      driftMissing = [];
      const vm = fd.versionMismatch;
      alertWarning(
        `schema-drift-check: PostgreSQL メジャーバージョン不一致（期待値=${vm.expected ?? '不明'} / 本番=${vm.actual ?? '不明'}）。突合が成立していません`,
        { route: '/api/cron/schema-drift-check', extra: vm },
      );
    } else if (fd.vacuous) {
      // 0 件同士は「一致」ではなく「測れていない」。緑と読み替えさせない。
      fingerprintCheckSkipped = true;
      driftExtra = [];
      driftMissing = [];
      alertWarning(
        `schema-drift-check: フィンガープリントが ${actual.length} 項目しか返らない（走査が空振り）`,
        { route: '/api/cron/schema-drift-check', extra: { actualCount: actual.length } },
      );
    }
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

  // ── severity 分類（Pillar 2・2026年8月10日）──
  // 🔴 critical = 本番が「期待（migration由来）より古い/欠けている」側。デプロイ済みコードが
  //   前提とするスキーマ/データを本番が欠く可能性があり、実害に直結し得る：
  //     - driftMissing（diffFingerprint）: migration にはあるが本番に無い定義
  //       （未適用 migration の疑い、または out-of-band 削除）
  //     - missing（computeDrift）: 期待テーブルが本番に無い（同じ「欠落」class）
  //     - reviewAuthenticityDrift: 正規入口では原理的に発生しない値＝サイト外からの
  //       不正投入の疑い（偽レビュー/PII混入）
  // 🟡 warning = 本番側の「out-of-band な追加/値ズレ」。多くは残骸で、🔴 ほど急を要さない：
  //     - contaminated（computeDrift）: 期待に無いテーブルが本番にある
  //     - colDrift（computeDrift）: 列差分
  //     - driftExtra（diffFingerprint）: migration には無いが本番にある定義
  //     - businessTypeDrift: 正規タクソノミー外の値
  const criticalCount = missing.length + driftMissing.length + reviewAuthenticityDrift.length;
  const warningCount = contaminated.length + colDrift.length + driftExtra.length + businessTypeDrift.length;
  // 🔴 driftCount の代入文は下のまま【1文】で維持する。review-authenticity-guard.test.ts が
  //   driftCount への代入文に reviewAuthenticityDrift.length が含まれることをテキストで
  //   固定しているため（正規表現でこの1文だけを抜き出して検査するので、この直前のコメントに
  //   同じ字面を書くと誤って先にマッチする＝実際に踏んだ）。criticalCount 経由に畳むと、値は
  //   数学的に同一でも文字列としての式から reviewAuthenticityDrift の項が消え、
  //   「検知結果が driftCount に算入されなくなった」という実回帰をこのガードが
  //   検出できなくなる。criticalCount/warningCount は severity 分類専用の別集計として
  //   並行に持つ（driftCount と criticalCount+warningCount は数学的に同値）。
  const driftCount =
    contaminated.length +
    missing.length +
    colDrift.length +
    driftExtra.length +
    driftMissing.length +
    businessTypeDrift.length +
    reviewAuthenticityDrift.length;

  // 【claim-first 設計・2026-07-17、severity 分割は2026年8月10日】
  // cron は三重化（GitHub Actions + pg_cron + Render）で同一スケジュール(JST 02:40)に
  // ほぼ同時発火するため、同一ドリフトに対して複数 run が同時に alertWarning/alertError を
  // 叩き、Slack へ重複警報が飛んでいた。alertWarning/alertError はスレッド集約のみで送信
  // 自体は毎回行うため集約では防げない。事前 SELECT で確認してから送る方式は TOCTOU（確認後
  // に別 run が割り込む余地がある）を再導入するため使わない。birthday-coupon / review-request
  // と同型の claim-first：送信直前に (job_name, claim_key) を INSERT して「送信権」を claim し、
  // PRIMARY KEY 違反(23505)なら他 run が先取り済みとして送信をスキップする（claimAndAlert）。
  //
  // claim_key は「当日(UTC)＋severity＋drift内容の指紋」で構成する。severity を含めるのは、
  // 🔴 と 🟡 が同一 run で同時に発生し得て、かつ互いに独立して dedup されるべきため
  // （🔴 が他 run に先取りされても 🟡 は別 run が拾える。job_name は両 severity で共有する
  // ため stale claim の掃除は1回で両方をカバーする）。
  let criticalDeduped = false;
  let warningDeduped = false;
  if (driftCount > 0) {
    if (criticalCount > 0) {
      criticalDeduped = await claimAndAlert(
        admin,
        startedAt,
        'critical',
        { missing, driftMissing, reviewAuthenticityDrift },
        () => {
          alertError(
            `スキーマドリフト検知: 本番が migration より古い（未適用migrationの疑い）= 本番に無い定義: ${driftMissing.length}件 / 期待テーブル欠落: ${missing.length}件 / 口コミ真正性ドリフト: ${reviewAuthenticityDrift.length}件`,
            {
              route: '/api/cron/schema-drift-check',
              extra: { missing, driftMissing, reviewAuthenticityDrift },
            },
          );
        },
      );
    }

    if (warningCount > 0) {
      warningDeduped = await claimAndAlert(
        admin,
        startedAt,
        'warning',
        { contaminated, colDrift, driftExtra, businessTypeDrift },
        () => {
          alertWarning(
            `スキーマドリフト検知（out-of-band な追加/値ズレの疑い）: 混入${contaminated.length} / 列差分${colDrift.length} / スキーマ差分追加${driftExtra.length} / 業種値ドリフト${businessTypeDrift.length}`,
            {
              route: '/api/cron/schema-drift-check',
              extra: { contaminated, colDrift, driftExtra, businessTypeDrift },
            },
          );
        },
      );
    }

    // 古い claim 行の掃除（保持期間超過分を削除）。best-effort・失敗しても本体は継続する
    // （テーブル肥大化の防止のみが目的で、失敗しても通知ロジックの正しさに影響しない）。
    // job_name を自ジョブに限定する：テーブルは (job_name, claim_key) 設計で将来他 cron と
    // 共有し得るため、無条件 delete だと他ジョブの claim 行を越境削除してしまう。
    // job_name は critical/warning 共通（'schema-drift-check'）のため1回の delete で両方の
    // stale claim をカバーする。
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
      driftExtra,
      driftMissing,
      businessTypeDrift,
      reviewAuthenticityDrift,
      fingerprintCheckSkipped,
      criticalCount,
      warningCount,
      criticalDeduped,
      warningDeduped,
      // 後方互換：いずれかの severity が dedup されていれば true（旧フィールド名を維持）。
      alertDeduped: criticalDeduped || warningDeduped,
    },
  });
  return NextResponse.json({
    ok: true,
    driftCount,
    criticalCount,
    warningCount,
    contaminated,
    missing,
    colDrift,
    driftExtra,
    driftMissing,
    businessTypeDrift,
    reviewAuthenticityDrift,
    fingerprintCheckSkipped,
  });
}
