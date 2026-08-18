/**
 * 「CareLink 自社の LINE チャネルから自動配信する cron」を台帳で固定する。
 *
 * 🔴 なぜ必要か（神原さん決定・2026年7月22〜23日）
 * 「LINE はそもそも CareLink が用意するものではない」。各店舗が自店の LINE 公式アカウントで
 * 送るのが原則で、自社チャネルからの自動配信は増やさない。
 * この方針は文章としては残っていたが【コードには一切効いておらず】、review-request の撤去
 * （PR #526）の後も birthday-coupon だけが課金ゲートも設定トグルも無いまま無条件で
 * 送り続けていた（Issue #527）。文章だけでは守れないことが実際に起きたので、台帳にする。
 *
 * 【この検査の性質】
 * LINE を使うこと自体を禁止していない。使ってよい経路を列挙し、【列挙されていない cron が
 * LINE を触ったら落とす】。新しい自動配信を足すときは、ここへ理由を書く手が必ず止まる。
 * 逆に、列挙したのに実際は使っていない場合も落とす（台帳が実態から腐るのを防ぐため）。
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const CRON_DIR = join(process.cwd(), 'src', 'app', 'api', 'cron');

/** LINE 送信に到達し得る参照。動的 import も含めるため文字列で見る。 */
const LINE_MARKERS = [/from '@\/lib\/line'/, /import\('@\/lib\/line'\)/];

/**
 * 自社 LINE チャネルからの送信が認められている cron と、その根拠。
 * ⚠️ ここへ足すのは「課金ゲートまたは施設側の明示設定に従属する」経路だけにすること。
 */
const ALLOWED: Record<string, string> = {
  'booking-reminder':
    '有料 entitlement reminder_line ＋ 施設設定 remind_3d_line / remind_7d_line の両方が真のときだけ送る。既定は OFF。',
  'webhook-retry':
    '再送キューの実行役。送信を新たに始めるのではなく、上記の経路が積んだ失敗ジョブを送り直すだけ。',
};

function cronRoutes(): Array<{ name: string; source: string }> {
  return readdirSync(CRON_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, path: join(CRON_DIR, e.name, 'route.ts') }))
    .filter((e) => {
      try {
        readFileSync(e.path, 'utf8');
        return true;
      } catch {
        return false;
      }
    })
    .map((e) => ({ name: e.name, source: readFileSync(e.path, 'utf8') }));
}

function usesLine(source: string): boolean {
  return LINE_MARKERS.some((marker) => marker.test(source));
}

describe('cron からの自社 LINE 自動配信', () => {
  it('走査対象の cron が実在する（空振りで緑にしない）', () => {
    expect(cronRoutes().length).toBeGreaterThanOrEqual(10);
  });

  it('台帳に無い cron は LINE を送らない', () => {
    const offenders = cronRoutes()
      .filter((r) => usesLine(r.source))
      .map((r) => r.name)
      .filter((name) => !(name in ALLOWED));

    expect(offenders).toEqual([]);
  });

  it('台帳に載せた cron は実際に LINE を使っている（腐った記載を残さない）', () => {
    const actual = new Set(cronRoutes().filter((r) => usesLine(r.source)).map((r) => r.name));
    const stale = Object.keys(ALLOWED).filter((name) => !actual.has(name));

    expect(stale).toEqual([]);
  });

  it('誕生日クーポンはメールのみ（Issue #527・無条件の自社LINE配信を撤去済み）', () => {
    const birthday = cronRoutes().find((r) => r.name === 'birthday-coupon');
    expect(birthday).toBeDefined();
    expect(usesLine((birthday as { source: string }).source)).toBe(false);
  });

  it('口コミ依頼はメールのみ（PR #526 で撤去済み）', () => {
    const reviewRequest = cronRoutes().find((r) => r.name === 'review-request');
    expect(reviewRequest).toBeDefined();
    expect(usesLine((reviewRequest as { source: string }).source)).toBe(false);
  });
});
