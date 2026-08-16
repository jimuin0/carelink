const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{ts,tsx}',
    '<rootDir>/src/**/*.{test,spec}.{ts,tsx}',
  ],
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    // API ルートは .ts に加え .tsx も測定対象に含める。
    // OGP 画像生成など JSX を返す Route Handler（例: src/app/api/og/route.tsx）が
    // .ts 限定 glob だと測定漏れ（盲点）になり、未テストでも branches 100% が
    // 偽って維持される事象を物理的に防ぐ（発症前予防）。
    'src/app/api/**/*.{ts,tsx}',
    // Render cron dispatcher が使う純粋ロジック（.mjs）も branches 100% ゲート対象に含める。
    'src/lib/**/*.mjs',
    '!src/**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 75,
      // L3: ブランチカバレッジ100%維持を CI で物理ゲート（測定スコープ内で実測100%）。
      // 下回ると jest --coverage が exit 1 し、ci.yml の Coverage Gate で検知される。
      // 注意：ローカルで branches が 100% 未満（99.89% 等）になることがあるが、これは .env
      // （gitignore・EMAIL_FROM / NEXT_PUBLIC_BASE_URL / RESEND_API_KEY 等）を next/jest が読み、
      // `process.env.X || 'default'` の default 分岐（env 未設定時）が踏まれないための偽陽性。
      // CI には .env が無いため両分岐がカバーされ 100%。ローカルで再現確認するなら .env を一時退避
      // （mv .env .env.__bak → 実行 → trap で必ず復元）して実行する。
      branches: 100,
      statements: 80,
    },
  },
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  // テストタイムアウト: 10秒（デフォルト5秒から延長）
  testTimeout: 10000,
  // 【偽アラーム抑止・2026年8月16日】worker プール終了の猶予。既定 500ms から延長する。
  //
  // jest は全テスト終了後、worker 7本へ同一 tick で END を送り、それぞれに
  // workerGracefulExitTimeout の setTimeout を張る（jest-worker の BaseWorkerPool.end）。
  // このタイマーが発火すると forceExited が立ち、jest-runner が
  // 「A worker process has failed to exit gracefully ... likely caused by tests leaking」
  // と警告する。ところが【このフラグは子プロセスの生死を一切参照しない】。子が正常終了
  // していても、親のイベントループが猶予を超えて詰まれば真になる（libuv は timers を
  // poll より先に回すため、exit イベントが ready でもタイマーが勝つ）。7本を OR で
  // 畳み込むので、1本でも遅れれば鳴る。
  //
  // 実測（猶予を 30000ms に上げて worker の「真の終了時間」を測ったもの）：
  //   無負荷        : [37,57,62,72,73,74,87] ms      ← 既定 500ms に対し 4〜6倍のマージン
  //   高負荷        : [318,321,375,467,503,638,691] ms ← 全7本が自力終了・最遅 691ms
  //   最大負荷・猶予500: [337,393,530,542,595,601,626] ms ← 626ms が閾値超え → 警告発火
  // 30000ms に張り付いた worker は1本も無い＝【リークは存在せず、犯人はスケジューリング
  // 遅延】。実際 `npm run test:coverage:ci` と `npx tsc --noEmit` の同時実行でだけ鳴り、
  // 無負荷では4回中0回だった。この偽アラームは「テストがリークしている」と誤誘導し、
  // 実際に数時間の調査を空費させた。
  //
  // 5000ms にしてもリーク検知は失われない。本物のリークがあれば子は自力終了できず
  // （jest-worker の exitProcess は process.exit を呼ばず message リスナを外すだけ）、
  // 猶予をいくら伸ばしても最後は必ず強制終了して警告が出る（発火が遅れるだけ）。
  //
  // ⚠️ 警告文は --detectOpenHandles を勧めるが、これは切り分けに使えない。同オプションは
  // shouldRunInBand を true にして worker プール経路そのものを止めるため、警告は原理的に
  // 出なくなる（消えても直った証拠にならない）。(a)リーク と (b)過負荷 を分けたいときは、
  // この値を大きくして worker の真の終了時間を測ること。
  workerGracefulExitTimeout: 5000,
};

// nextJest overwrites transformIgnorePatterns; merge it here
async function jestConfig() {
  const base = await createJestConfig(config)();
  return {
    ...base,
    transformIgnorePatterns: [
      '/node_modules/(?!(uncrypto)/)',
    ],
  };
}

module.exports = jestConfig;
