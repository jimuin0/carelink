// ESLint flat config（ESLint 10 で eslintrc 形式と --ext オプションが廃止されたため移行）。
//
// 🔴 移行の受け入れ基準は「.eslintrc.json 時代と検出結果が完全に一致すること」。
// ルールを1つ取りこぼしても lint は緑のまま通ってしまい、CareLink 固有の安全規約
// （carelink-safety の5ルール）が無音で無効化される。移行前後の出力を
// ファイル・行・列・規則名まで機械比較して確認すること
// （src/__tests__/eslint-flat-config-parity.test.ts が構成の取りこぼしを CI で止める）。
//
// 🔴 プラグインは相対パスで直接 import する（パッケージ名で解決しない）。
// why: node_modules/eslint-plugin-carelink-safety は package.json の `file:` 依存が作る
// symlink で、Claude Code の worktree 運用では実体が別 checkout を指したり宙吊りになったりして
// lint が全滅する事故が繰り返し起きていた（CLAUDE.md「worktree 運用の罠」）。
// flat config は設定ファイル自身からの相対 import なので、symlink の状態に一切依存しない。
import carelinkSafety from './eslint-plugin-carelink-safety/index.js';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// eslint-config-next は Next 本体と版を揃える（16.3.0）。16 系は flat config を native に出すため
// FlatCompat（eslintrc 形式のブリッジ）は不要になった。
//
// 16 系は React Compiler ベースの react-hooks ルール（set-state-in-effect / purity /
// immutability / refs / incompatible-library）を有効にする。これらは effect 内の同期 setState が
// 連鎖レンダリングを起こす等、実挙動に効く指摘なので抑止せずコード側を是正する方針。

export default [
  {
    // 🔴 flat config は既定で **/*.js / *.cjs / *.mjs しか対象にしない。
    // .eslintrc.json 時代は lint スクリプトの `--ext .js,.jsx,.ts,.tsx` が対象を決めていたので、
    // 同じ集合をここで宣言する（.mjs を含めないのも当時と揃えるため。含めると
    // src/lib/*.mjs が新たに対象になり、移行前後の検出結果が一致しなくなる）。
    name: 'carelink/files',
    files: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx'],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    // 🔴 React Compiler ベースの react-hooks ルールを【警告】に落としている。抑止ではなく段階的返済のため。
    //
    // 何を指しているか: これらは個別のミスではなく【クライアントコンポーネントがマウント時に
    // fetch して setState する】という設計パターン全体への指摘で、2026年8月16日 の実測で
    // 72 件 / 58 ファイル（全て 'use client'）が該当した。エラー行はいずれも
    // `useEffect(() => { load(); }, [load])` を指し、load() の呼び出し箇所はその effect だけ。
    // つまり正しい直し方は「データ取得を effect の外へ出す」＝ App Router のサーバー
    // コンポーネント化やデータ取得層の導入で、管理画面の取得構造そのものの作り替えになる。
    //
    // なぜ一度に直さないか: 対象に予約フロー（BookingFlow.tsx・8件）を含む 58 コンポーネントが
    // あり、描画タイミングを一度に変えると、テストが緑のまま実機で壊れる退行が出たときに
    // 原因を切り分けられない。
    //
    // ⚠️ 警告に落とすと普通は放置されるので、放置できない仕組みを併設してある。
    // scripts/check-react-compiler-debt.mjs が件数を数え、ベースラインと【厳密一致】しなければ
    // CI を落とす。増えたら退行として止まり、減ったらベースラインの更新を要求する
    // （数字が実態から乖離して意味を失うことを防ぐ）。
    name: 'carelink/react-compiler-debt',
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
    },
  },

  {
    name: 'carelink/base',
    plugins: { 'carelink-safety': carelinkSafety },
    rules: {
      'carelink-safety/no-await-fire-and-forget': 'error',
      'carelink-safety/no-bare-sentry-capture': 'error',
      'carelink-safety/no-discarded-supabase-error': 'error',
      'carelink-safety/no-anon-select-rls-protected-table': 'error',
      'carelink-safety/no-anon-write-rls-protected-table': 'error',
      'no-restricted-globals': [
        'error',
        {
          name: 'alert',
          message: 'alert() は使わず Toast を使ってください（UI 一貫性・スクリーンリーダー対応）。',
        },
        {
          name: 'confirm',
          message: 'confirm() は使わず ConfirmDialog を使ってください（UI 一貫性・a11y）。',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'alert',
          message: 'window.alert は使わず Toast を使ってください。',
        },
        {
          object: 'window',
          property: 'confirm',
          message: 'window.confirm は使わず ConfirmDialog を使ってください。',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/rate-limit',
              importNames: ['inMemoryRateLimit'],
              message:
                'inMemoryRateLimit はプロセス内Mapのためサーバーレス環境ではインスタンス分散でバイパス可能です。共有DBベースの checkRateLimit を使用してください（inMemoryRateLimit は rate-limit.ts 内部のフォールバック専用）。',
            },
          ],
        },
      ],
    },
  },

  // 以下は .eslintrc.json の overrides を順序どおり移植したもの。
  // flat config は後勝ちなので、base の後ろにこの順で置くこと。
  {
    name: 'carelink/tests',
    files: ['**/__tests__/**/*.ts', '**/__tests__/**/*.tsx', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'carelink-safety/no-bare-sentry-capture': 'off',
      'carelink-safety/no-await-fire-and-forget': 'off',
    },
  },
  {
    name: 'carelink/rate-limit-test',
    files: ['src/lib/__tests__/rate-limit.test.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    name: 'carelink/safe-module',
    files: ['src/lib/safe.ts'],
    rules: { 'carelink-safety/no-bare-sentry-capture': 'off' },
  },
  // ⚠️ .eslintrc.json には src/app/api/sentry-check/route.ts に対する
  // carelink-safety/no-bare-sentry-capture の除外もあったが、そのファイルは
  // 現在のリポジトリにも origin/main にも存在しない（削除済みのルート）。
  // 実在しないパスへのルール除外は、将来同名のファイルが作られたときに
  // 誰も意図していない免除を静かに与えるだけなので移植せず撤去した。
  {
    // .eslintrc.json では excludedFiles だったものを flat config の ignores へ移植。
    name: 'carelink/admin-table',
    files: ['src/app/admin/**/*.tsx'],
    ignores: ['**/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='table']",
          message:
            '管理ページで生の <table> は使わず @/components/admin/SbUi の <SbTable> を使ってください（一覧テーブルの見た目・横スクロール挙動を統一・単一ソース化するため）。',
        },
      ],
    },
  },
];
