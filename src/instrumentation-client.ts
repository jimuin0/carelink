// Next.js が画面のコードより先にブラウザで実行するファイル（instrumentation-client）。
// zod のスキーマが作られる前に jitless を設定し、CSP 違反（eval の探査）を出さない。
// 理由は src/lib/zod-runtime-config.ts を参照。
import './lib/zod-runtime-config';
