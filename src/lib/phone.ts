import { z } from 'zod';

/**
 * 日本の電話番号フォーマット（090-1234-5678 / 03-1234-5678 等）。
 * 先頭0必須・数字と任意ハイフンのみ。国際表記(+81)は非対応（既存仕様を踏襲）。
 */
export const phoneRegex = /^0\d{1,4}-?\d{1,4}-?\d{3,4}$/;

/**
 * 電話番号の表記ゆれを正規化する（監査F1の根治・全呼び出し元に適用）。
 *
 * 予約フォーム等でユーザーが全角数字「０９０…」や全角ハイフン・空白を入力すると、
 * クライアントは素通しなのにサーバ regex で 400 になり「理由不明のエラー」になっていた。
 * 保存/検証の前に半角へ寄せることで、入力の揺れを恒久的に吸収する。
 *
 * - NFKC で全角英数字・全角ハイフンを半角化。
 * - 各種ダッシュ・長音記号(ー/ｰ/–/—/―/−)をハイフンに統一。
 * - 空白（半角/全角）を除去。
 * 正当な半角番号は不変（冪等）。純粋な改善であり既存の妥当データを壊さない。
 */
export function normalizePhone(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[‐-‒–—―ーｰ−]/g, '-')
    .replace(/\s+/g, '');
}

/**
 * 電話番号フィールドの共有スキーマ生成。
 * transform で normalizePhone を通してから refine で形式検証する。
 * （z.preprocess は入力型が unknown になり react-hook-form の Resolver 型と衝突するため
 * 使わない。transform 方式なら入力型は string のまま保たれ、正規化後の値が検証・保存される。）
 * @param opts.required true なら空文字を許さず必須にする
 */
export function phoneField(opts: { required?: boolean } = {}) {
  if (opts.required) {
    return z.string()
      .transform(normalizePhone)
      .refine((v) => phoneRegex.test(v), '正しい電話番号を入力してください');
  }
  return z.string()
    .transform(normalizePhone)
    .refine((v) => v === '' || phoneRegex.test(v), '正しい電話番号を入力してください')
    .optional()
    .nullable();
}
