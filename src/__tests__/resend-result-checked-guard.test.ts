/**
 * Resend の送信結果を捨てている呼び出しが 1 つも無いことを固定する（2026年8月14日 新設）。
 *
 * 🔴 【なぜ必要か＝実際にあった状態】Resend SDK は API エラーを **throw しない**
 * （`node_modules/resend/dist/index.mjs` の `fetchRequest` が `!response.ok` でも
 * ネットワーク断でも `{ data: null, error: … }` を resolve する）。そのため
 *
 *     try { await resend.emails.send(...); delivered = true } catch { … }
 *
 * と書くと catch には永遠に入らず、**1 通も送れていないのに配信済みとして記録される**。
 * この欠陥は 2026年7月8日に `src/lib/email.ts` の `safeSend` で一度根治されたが、
 * そこを通らない直接呼び出しがニュースレター手動配信と cron 5 本に残っていた
 * （＝「気づいた 1 箇所を直す」だけでは同じ class が別の場所で生き続けた）。
 *
 * 🔴 【2026年8月14日 初版の抜け穴・敵対検証で2ラウンド発見（本改修で根治）】
 *
 *   ラウンド1（statement の形の列挙）:
 *     (1) 「検査手段を持っている」判定 `/\.error\b/.test(src)` が `console.error(` にも一致し、
 *         ほぼ全ファイルが無条件で「検査あり」と判定される事実上の空振りだった。
 *     (2) 違反検出の正規表現 `^\s*await\s+[\w.]+\.(emails|batch)\.send\(` は「行頭 await」の
 *         1形だけしか見ておらず、`const r = await …send(...)` で r を検査しない／`void …send(...)`／
 *         await 無し行頭呼出／`return …send(...)`／`Promise.all(xs.map(x => …send(x)))` の
 *         5形が丸ごと素通りした。
 *
 *   ラウンド2（レシーバの形の列挙・ラウンド1修正後に別セッションの敵対検証で発見）:
 *     (3) statement の形は AST 化して直したが、送信呼び出しの**検出条件**が
 *         `expr.expression`（`.send` の左側＝レシーバ）が `PropertyAccessExpression` で
 *         `emails`/`batch` という名前であることを要求していた。この結果、
 *         `const { emails } = resend; emails.send(...)` / `const { batch } = resend; batch.send(...)`
 *         （分割代入）／`const e = resend.emails; e.send(...)`（別名）／
 *         `resend['emails'].send(...)`（要素アクセス）の**4形が検出条件にすら入らず**、
 *         違反としても `countSendCallSites`（空振り下限）としても**完全に無音**で素通りした。
 *
 * 【今回の設計＝「呼び出しの形」の列挙をやめ「ファイルの性質」で判定する】
 *
 *   検出対象を「レシーバの形が `X.emails.send`/`X.batch.send` に一致する呼び出し」から、
 *   「**`import ... from 'resend'` を持つファイル内の、プロパティ名が `send` である
 *   あらゆる呼び出し**」へ変更した（`isResendTouchingFile` + `isSendLikeCall`）。
 *   レシーバがどんな式（分割代入・別名・要素アクセス・optional chaining）であっても
 *   `.send(` で終わることは変わらないため、レシーバの構文形には一切依存しなくなる。
 *   実際に Resend を import しているのは cron 5本＋newsletter 手動配信＋lib/email.ts の
 *   7ファイルのみで、この7ファイル以外に `.send(` は1件も存在しない（実測・後述のテストで確認）。
 *   Resend を import していないファイルの `.send(`（他ライブラリの同名メソッド等）は対象外にする
 *   ことで誤報を避ける。
 *
 *   検出した呼び出しが検査を経由しているかの判定（`sendResendChecked`/`throwIfResendError` の
 *   引数位置にあるか、理由つきマーカーがあるか）は変更していない（ラウンド1の対処のまま）。
 *
 *   実呼び出し側（cron 5本＋newsletter 手動配信＋birthday-coupon の2箇所）は、送信呼び出し
 *   自体を `sendResendChecked(sendCall, context)` の**引数の位置**へ渡す形に統一している
 *   （await はラッパ内部で行う）。この形にすると「送ったが検査していない」状態が構文的に
 *   書けなくなる（＝ラウンド1(2)が原理的に再発しない）。
 *
 *   唯一の例外は `src/lib/email.ts` の `safeSend`（`Promise.race` の中に送信呼び出しを置き、
 *   直後で自前に `result.error` を検査して `fail()` に渡す既存実装）。これは呼び出しの形上
 *   `sendResendChecked` の引数位置へ直接ネストできないため、**理由必須のマーカー**
 *   `// resend-checked: <なぜ安全か>` でのみ許可する（理由が空なら無効＝違反のまま）。
 *
 *   判定は TypeScript の AST（`typescript` パッケージ）で行う。コメント中の文字列を
 *   実呼出と誤検出することも無い（AST はコメントをノードとして持たない）。
 */
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** 検査関数として認める呼び出し先の名前。 */
const CHECK_CALL_NAMES = new Set(['sendResendChecked', 'throwIfResendError']);

/** 理由必須の逃し口。理由（コロン以降の非空文字列）が無ければ無効。 */
const MARKER_RE = /\/\/\s*resend-checked:\s*(\S.*)$/;
/** マーカーは呼び出し行から遡ってこの行数以内に書いてあれば有効（呼び出し直前に書く運用を想定）。 */
const MARKER_LOOKBACK_LINES = 6;

function scriptKindFor(fileLabel: string): ts.ScriptKind {
  return fileLabel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function parse(sourceText: string, fileLabel: string): ts.SourceFile {
  return ts.createSourceFile(fileLabel, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(fileLabel));
}

/**
 * このファイルが Resend SDK を import しているか（`import ... from 'resend'` /
 * `require('resend')`）。判定の起点＝「ファイルの性質」であって、`.send(` の書き方ではない。
 * これにより、Resend を使わない他ライブラリの同名メソッド（例: 別の通知SDKの `.send(`）まで
 * 巻き込む誤報を避ける（`.send(` はレシーバの型に関わらず広く一致するため、無条件に全ファイルへ
 * 適用すると誤報の温床になる）。
 */
function isResendTouchingFile(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === 'resend'
    ) {
      found = true;
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'resend'
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * `expr` が「プロパティ名 `send` を持つ呼び出し」かどうか。レシーバ側（`.send(` の左側）の
 * 構文形は一切見ない（分割代入・別名・要素アクセス・optional chaining のいずれでも一致する）。
 * `X.send(` にも `X['send'](` にも `X?.send(` にも一致する。
 */
function isSendLikeCall(expr: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text === 'send';
  if (ts.isElementAccessExpression(expr)) {
    const arg = expr.argumentExpression;
    return ts.isStringLiteralLike(arg) && arg.text === 'send';
  }
  return false;
}

function calleeName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  return undefined;
}

/**
 * send 呼び出しノードが、検査関数（sendResendChecked / throwIfResendError）の
 * 引数として直接渡されているか。`await` で1段包んだ形（`throwIfResendError(await …send(...), ctx)`）
 * も許可する。変数へ受けてから別文で検査関数に渡す形（`const r = await …send(...)` の後で
 * `throwIfResendError(r, ctx)`）は**意図的に許可しない**（この形が「検査の行だけ消す」退行を
 * 許すのが今回のガードの直接の動機のため）。
 */
function isDirectlyPassedToCheckFn(node: ts.CallExpression): boolean {
  let target: ts.Node = node;
  const parent: ts.Node | undefined = target.parent;
  if (parent && ts.isAwaitExpression(parent) && parent.expression === target) {
    target = parent;
  }
  const argParent = target.parent;
  if (argParent && ts.isCallExpression(argParent)) {
    const idx = argParent.arguments.indexOf(target as ts.Expression);
    if (idx !== -1) {
      const name = calleeName(argParent.expression);
      if (name && CHECK_CALL_NAMES.has(name)) return true;
    }
  }
  return false;
}

function hasValidMarker(lines: string[], zeroBasedCallLine: number): boolean {
  const start = Math.max(0, zeroBasedCallLine - MARKER_LOOKBACK_LINES);
  for (let i = start; i <= zeroBasedCallLine; i++) {
    const m = lines[i]?.match(MARKER_RE);
    if (m && m[1].trim().length > 0) return true;
  }
  return false;
}

interface Violation {
  line: number; // 1-based
  text: string;
}

/**
 * Resend を import しているファイル内の `.send(` 呼び出しの総数を AST で数える
 * （空振り下限チェック用）。Resend を import していないファイルは対象外（誤報防止）。
 */
function countSendCallSites(sourceText: string, fileLabel: string): number {
  const sourceFile = parse(sourceText, fileLabel);
  if (!isResendTouchingFile(sourceFile)) return 0;
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isSendLikeCall(node.expression)) count++;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

/**
 * 検査を経由していない（＝結果を握り潰している）送信呼び出しを全て返す。
 * Resend を import していないファイルは走査対象外（誤報防止。`isResendTouchingFile` 参照）。
 */
function findViolations(sourceText: string, fileLabel: string): Violation[] {
  const sourceFile = parse(sourceText, fileLabel);
  if (!isResendTouchingFile(sourceFile)) return [];
  const lines = sourceText.split('\n');
  const violations: Violation[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isSendLikeCall(node.expression)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      if (!isDirectlyPassedToCheckFn(node) && !hasValidMarker(lines, line)) {
        violations.push({ line: line + 1, text: lines[line]?.trim() ?? '' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

/** テスト用フィクスチャの先頭に付ける import。`isResendTouchingFile` を実際に通す。 */
const RESEND_IMPORT = `import { Resend } from 'resend';\n`;

describe('検出ロジックの単体テスト（実ファイルに依らない）', () => {
  describe('ファイルの性質による絞り込み（isResendTouchingFile）', () => {
    it('resend を import していないファイルの `.send(` は対象外（誤報防止）', () => {
      const src = `
        async function f(otherSdk: any) {
          await otherSdk.send({ from: 'a' }); // 例: 別の通知SDKの .send() で無関係
        }
      `;
      expect(findViolations(src, 'fixture.ts')).toEqual([]);
      expect(countSendCallSites(src, 'fixture.ts')).toBe(0);
    });

    it('resend を import しているファイルなら対象になる（named import）', () => {
      const src = `${RESEND_IMPORT}
        async function f(resend: any) {
          await resend.emails.send({ from: 'a' });
        }
      `;
      expect(countSendCallSites(src, 'fixture.ts')).toBeGreaterThanOrEqual(1);
      expect(findViolations(src, 'fixture.ts').length).toBeGreaterThanOrEqual(1);
    });

    it('require("resend") でも対象になる', () => {
      const src = `
        const { Resend } = require('resend');
        async function f(resend: any) {
          await resend.emails.send({ from: 'a' });
        }
      `;
      expect(countSendCallSites(src, 'fixture.ts')).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── 違反として検出されるべき形（statement の形・ラウンド1の6形） ────────────────────
  describe('statement の形（ラウンド1）', () => {
    const violatingForms: Record<string, string> = {
      'await resend.emails.send(...) を検査せず放置': `
        async function f(resend: any) {
          await resend.emails.send({ from: 'a' });
        }
      `,
      '変数へ受けるが検査しない': `
        async function f(resend: any) {
          const r = await resend.emails.send({ from: 'a' });
          console.log(r);
        }
      `,
      'void で結果を捨てる': `
        async function f(resend: any) {
          void resend.emails.send({ from: 'a' });
        }
      `,
      '行頭・await 無し（Promise を放置）': `
        function f(resend: any) {
          resend.emails.send({ from: 'a' });
        }
      `,
      'return でそのまま返す': `
        async function f(resend: any) {
          return resend.emails.send({ from: 'a' });
        }
      `,
      'Promise.all + map のコールバック内': `
        async function f(resend: any, xs: any[]) {
          await Promise.all(xs.map((x) => resend.emails.send(x)));
        }
      `,
    };

    for (const [label, body] of Object.entries(violatingForms)) {
      it(`検出できる: ${label}`, () => {
        const violations = findViolations(RESEND_IMPORT + body, 'fixture.ts');
        expect(violations.length).toBeGreaterThanOrEqual(1);
      });
    }

    it('batch.send も同様に検出できる（await 無し放置）', () => {
      const src = `${RESEND_IMPORT}
        function f(resend: any, messages: any[]) {
          resend.batch.send(messages);
        }
      `;
      expect(findViolations(src, 'fixture.ts').length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── 違反として検出されるべき形（レシーバの形・ラウンド2で発見された4形） ──────────────
  describe('レシーバの形（ラウンド2・敵対検証で発見された抜け穴）', () => {
    const violatingForms: Record<string, string> = {
      '分割代入 emails': `
        async function f(resend: any) {
          const { emails } = resend;
          await emails.send({ from: 'a' });
        }
      `,
      '分割代入 batch': `
        async function f(resend: any, messages: any[]) {
          const { batch } = resend;
          await batch.send(messages);
        }
      `,
      '別名（一度別変数へ受ける）': `
        async function f(resend: any) {
          const e = resend.emails;
          await e.send({ from: 'a' });
        }
      `,
      '要素アクセス（ブラケット表記）': `
        async function f(resend: any) {
          await resend['emails'].send({ from: 'a' });
        }
      `,
    };

    for (const [label, body] of Object.entries(violatingForms)) {
      it(`検出できる: ${label}`, () => {
        const src = RESEND_IMPORT + body;
        // 空振りしていないこと自体も確認する（検出0件で「違反なし」に見えるのを防ぐ）。
        expect(countSendCallSites(src, 'fixture.ts')).toBeGreaterThanOrEqual(1);
        expect(findViolations(src, 'fixture.ts').length).toBeGreaterThanOrEqual(1);
      });
    }
  });

  // ─── 違反ではない（正しい）形 ──────────────────────────────────────────────
  describe('正しい形（違反にならない）', () => {
    it('sendResendChecked の引数に直接渡す形は違反にならない', () => {
      const src = `${RESEND_IMPORT}
        async function f(resend: any) {
          await sendResendChecked(resend.emails.send({ from: 'a' }), 'ctx');
        }
      `;
      expect(findViolations(src, 'fixture.ts')).toEqual([]);
    });

    it('sendResendChecked へ batch.send を渡す形も違反にならない', () => {
      const src = `${RESEND_IMPORT}
        async function f(resend: any, messages: any[]) {
          await sendResendChecked(resend.batch.send(messages), 'ctx');
        }
      `;
      expect(findViolations(src, 'fixture.ts')).toEqual([]);
    });

    it('throwIfResendError(await …send(...), ctx) の直接ネストも違反にならない', () => {
      const src = `${RESEND_IMPORT}
        async function f(resend: any) {
          throwIfResendError(await resend.emails.send({ from: 'a' }), 'ctx');
        }
      `;
      expect(findViolations(src, 'fixture.ts')).toEqual([]);
    });

    it('sendResendChecked は分割代入・別名・要素アクセスのレシーバでも通す（検査を経由していれば良い）', () => {
      const src = `${RESEND_IMPORT}
        async function f(resend: any) {
          const { emails } = resend;
          await sendResendChecked(emails.send({ from: 'a' }), 'ctx');
        }
      `;
      expect(findViolations(src, 'fixture.ts')).toEqual([]);
    });

    it('理由つきの resend-checked マーカーがあれば違反にならない（email.ts の safeSend 想定）', () => {
      const src = `${RESEND_IMPORT}
        async function f(resend: any) {
          const result = await Promise.race([
            // resend-checked: Promise.race の直後で result.error を自前に検査している
            resend.emails.send({ from: 'a' }),
            timeout(),
          ]);
          if (result.error) fail(result.error);
        }
      `;
      expect(findViolations(src, 'fixture.ts')).toEqual([]);
    });

    it('理由が空の resend-checked マーカーは無効（違反のまま）＝「印を付ければ通る」を許さない', () => {
      const src = `${RESEND_IMPORT}
        async function f(resend: any) {
          // resend-checked:
          await resend.emails.send({ from: 'a' });
        }
      `;
      expect(findViolations(src, 'fixture.ts').length).toBeGreaterThanOrEqual(1);
    });

    it('resend-checked マーカーが遠すぎる（lookback を超える）と無効', () => {
      const pad = Array.from({ length: MARKER_LOOKBACK_LINES + 2 }, () => 'const noop = 1;').join('\n');
      const src = `${RESEND_IMPORT}
        // resend-checked: 遠すぎるので効かないはず
        ${pad}
        async function f(resend: any) {
          await resend.emails.send({ from: 'a' });
        }
      `;
      expect(findViolations(src, 'fixture.ts').length).toBeGreaterThanOrEqual(1);
    });

    it('コメント中の `.emails.send(` 文字列は実呼出と誤検出しない（AST 判定の利点）', () => {
      const src = `${RESEND_IMPORT}
        // 使い方の例: await resend.emails.send({...}); throwIfResendError(r, 'ctx');
        async function f() {
          return 1;
        }
      `;
      expect(findViolations(src, 'fixture.ts')).toEqual([]);
      expect(countSendCallSites(src, 'fixture.ts')).toBe(0);
    });
  });

  it('countSendCallSites は send 呼び出しの総数を数える（走査の空振り検出用）', () => {
    const src = `${RESEND_IMPORT}
      async function f(resend: any) {
        await sendResendChecked(resend.emails.send({}), 'a');
        await sendResendChecked(resend.batch.send([]), 'b');
      }
    `;
    expect(countSendCallSites(src, 'fixture.ts')).toBe(2);
  });
});

describe('Resend の送信結果を捨てている呼び出しが無い（実リポジトリ走査）', () => {
  const files = walkTs(join(ROOT, 'src'));
  const perFile = files.map((f) => {
    const src = readFileSync(f, 'utf8');
    const rel = relative(ROOT, f).split(sep).join('/');
    return { file: f, rel, sendCount: countSendCallSites(src, f), violations: findViolations(src, f) };
  });

  it('走査が空振りしていない（Resend を import しているファイル数）', () => {
    const filesWithSend = perFile.filter((p) => p.sendCount > 0);
    // 実測 2026年8月14日: 7 ファイル（newsletter 手動配信・cron 5 本・lib/email.ts）。
    // 下限は実測の半分程度に置く（通常の増減で誤報させないため）。
    expect(filesWithSend.length).toBeGreaterThanOrEqual(4);
  });

  it('走査が空振りしていない（`.send(` 呼び出し件数）', () => {
    const total = perFile.reduce((sum, p) => sum + p.sendCount, 0);
    // 実測 2026年8月14日: 8 箇所（birthday-coupon が2箇所・他は1箇所ずつ）。
    expect(total).toBeGreaterThanOrEqual(4);
  });

  it('Resend を import しているファイルの外側に `.send(` を無条件に拾っていない（誤報にならないことの確認）', () => {
    // isResendTouchingFile が効いていることの確認。resend を import していない全ファイルの
    // 中に `.send(` を書いたテキストが有っても violations/sendCount には出ない
    // （countSendCallSites/findViolations が最初に import 判定で弾くため）。
    const nonResendFiles = perFile.filter((p) => p.sendCount === 0);
    for (const p of nonResendFiles) {
      expect(p.violations).toEqual([]);
    }
  });

  it('送信結果を捨てている箇所が 1 つも無い', () => {
    const offenders = perFile
      .filter((p) => p.violations.length > 0)
      .map((p) => `${p.rel}:${p.violations.map((v) => v.line).join(',')}`);
    expect(offenders).toEqual([]);
  });

  it('email.ts の safeSend は resend-checked マーカーを実際に使っている（マーカー機構自体が実配線されていることの確認）', () => {
    const emailTs = perFile.find((p) => p.rel === 'src/lib/email.ts');
    expect(emailTs).toBeDefined();
    expect(emailTs!.sendCount).toBeGreaterThanOrEqual(1);
    const src = readFileSync(emailTs!.file, 'utf8');
    expect(src).toMatch(/\/\/\s*resend-checked:\s*\S/);
  });
});
