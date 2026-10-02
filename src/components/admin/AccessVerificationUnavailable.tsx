'use client';

/** A layout cannot recover through its own error.tsx. Reload the current GET
 * document, including its query, rather than replaying a business mutation. */
export default function AccessVerificationUnavailable() {
  return (
    <section role="alert" className="mx-auto max-w-xl p-6 text-center">
      <h2 className="text-xl font-bold">管理画面の利用権限を確認できません</h2>
      <p className="my-4 text-gray-600">
        ログイン状態または権限の確認に失敗しました。この権限確認では変更・再送を行いません。
        時間をおいて、この画面を再確認してください。直前の操作結果は別途確認してください。
      </p>
      <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
        利用権限を再確認
      </button>
    </section>
  );
}
