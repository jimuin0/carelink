// テストでは waitUntil() は単に渡された Promise をそのまま返す（Vercelランタイムの
// バックグラウンド継続実行を再現する必要がないため）。Jest 手動モック規約により
// このファイルが node_modules 実体を自動的に置き換える。
module.exports = {
  waitUntil: jest.fn((promise) => promise),
};
