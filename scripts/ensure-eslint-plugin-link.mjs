#!/usr/bin/env node
// eslint-plugin-carelink-safety の node_modules シンボリックリンクが
// 宙吊り（削除済み worktree の絶対パス等を指したまま）になっていないかを
// prelint / pretest / postinstall のたびに検査し、宙吊りの場合のみ
// 正規の相対シンボリックリンク（../eslint-plugin-carelink-safety）へ
// 自動修復する。
//
// 背景：worktree 運用では worktree 側の node_modules がディレクトリごと
// 本家 node_modules へのシンボリックリンクになっているため、
// 「worktree 内で plugin リンクを張り替える」操作は物理的に本家の
// node_modules を書き換える。作業者がこれに気づかず worktree を削除すると
// 本家のリンクが宙吊りになり、本家の lint が Cannot find module で全滅する
// 事故が 2026年7月16日・17日に再発した（詳細は CLAUDE.md
// 「worktree 運用の罠」参照）。
//
// 設計方針：
// - 解決可能なリンク（意図的な worktree 実体への張り替え作業中を含む）には
//   一切手を出さない。宙吊りのみを検知して直す。
// - どの経路でも throw せず必ず exit 0（fail-safe。CI/Vercel のビルドを
//   本スクリプトの不具合で絶対に落とさない）。
// - 依存パッケージ不要（node:fs / node:path のみ）。シークレット・環境変数は
//   一切参照しない。

import fs from 'node:fs';
import path from 'node:path';

const PLUGIN_NAME = 'eslint-plugin-carelink-safety';
const RELATIVE_TARGET = `../${PLUGIN_NAME}`;

function main() {
  try {
    const repoRoot = process.cwd();
    const nodeModulesDir = path.join(repoRoot, 'node_modules');
    const pluginLinkPath = path.join(nodeModulesDir, PLUGIN_NAME);
    const pluginRealDir = path.join(repoRoot, PLUGIN_NAME);

    let nodeModulesExists = false;
    try {
      nodeModulesExists = fs.statSync(nodeModulesDir).isDirectory();
    } catch {
      nodeModulesExists = false;
    }

    if (!nodeModulesExists) {
      // node_modules 自体が無い（npm install 未実行等）。何もしない。
      return;
    }

    let lstatResult = null;
    try {
      lstatResult = fs.lstatSync(pluginLinkPath);
    } catch {
      lstatResult = null;
    }

    if (lstatResult) {
      // エントリが存在する。実体解決できるか確認する。
      try {
        fs.statSync(pluginLinkPath);
        // 解決成功＝正常（意図的な worktree 実体への張り替え作業中も含め、
        // 解決できるものには一切手を出さない）。
        return;
      } catch {
        // lstat 成功・stat 失敗＝宙吊り。旧リンク先を記録してから修復する。
        let oldTarget = '(不明・readlink失敗)';
        try {
          oldTarget = fs.readlinkSync(pluginLinkPath);
        } catch {
          // 無視（symlink でなかった等）。修復は続行する。
        }
        try {
          fs.unlinkSync(pluginLinkPath);
          fs.symlinkSync(RELATIVE_TARGET, pluginLinkPath, 'dir');
          console.warn(
            `[ensure-eslint-plugin-link] node_modules/${PLUGIN_NAME} が宙吊り（旧リンク先: ${oldTarget}）になっていたため、正規リンク（${RELATIVE_TARGET}）へ自動修復しました。`
          );
        } catch (repairError) {
          console.error(
            `[ensure-eslint-plugin-link] 宙吊りリンクの自動修復に失敗しました（旧リンク先: ${oldTarget}）: ${repairError && repairError.message ? repairError.message : repairError}`
          );
        }
        return;
      }
    }

    // エントリ自体が存在しない。リポジトリ内に plugin 実体があれば正規リンクを作成する。
    let pluginRealExists = false;
    try {
      pluginRealExists = fs.statSync(pluginRealDir).isDirectory();
    } catch {
      pluginRealExists = false;
    }

    if (pluginRealExists) {
      try {
        fs.symlinkSync(RELATIVE_TARGET, pluginLinkPath, 'dir');
        console.warn(
          `[ensure-eslint-plugin-link] node_modules/${PLUGIN_NAME} が存在しなかったため、正規リンク（${RELATIVE_TARGET}）を作成しました。`
        );
      } catch (createError) {
        console.error(
          `[ensure-eslint-plugin-link] 正規リンクの作成に失敗しました: ${createError && createError.message ? createError.message : createError}`
        );
      }
    }
    // pluginRealExists が false の場合は何もしない（リポジトリ構成が想定外）。
  } catch (unexpectedError) {
    // どんな想定外エラーでも本スクリプトが原因で CI/Vercel のビルドを
    // 落とさないよう、ここで握りつぶして exit 0 する。
    console.error(
      `[ensure-eslint-plugin-link] 予期しないエラーが発生しましたが処理を継続します: ${unexpectedError && unexpectedError.message ? unexpectedError.message : unexpectedError}`
    );
  }
}

main();
process.exit(0);
