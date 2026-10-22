'use client';

import { useEffect, useState } from 'react';
import {
  readThisDevicePushStatus, usePushSubscription, type PushDeviceStatus,
} from '@/hooks/usePushSubscription';

/**
 * この端末でプッシュ通知を受け取るための登録・解除（2026年10月22日 新設・店舗オーナーの通知設定）。
 * 2026年10月23日からお客様のマイページ（設定）でも使う：予約完了画面のバナーを閉じた・
 * 許可済みだが登録が消えた、といった場合に、お客様が登録し直す入口が他に無かったため。
 *
 * 通知設定には「新規予約（Push通知）」等のトグルがあったが、オーナーが端末を登録する手段が
 * 管理画面に 1 つも無く、トグルを ON にしても届け先が存在しなかった。
 *
 * 登録先は push_subscriptions（UNIQUE(user_id)＝1 人 1 端末）。別の端末で登録すると前の端末は
 * 置き換わるので、そのことを画面に書いておく。登録は店舗ごとではなくアカウントごと。
 */

type DeviceStatus = Exclude<PushDeviceStatus, { state: 'signed_out' }>;

async function readDeviceStatus(): Promise<DeviceStatus> {
  const status = await readThisDevicePushStatus();
  // この画面はログイン必須の画面にだけ置く。ログインを確認できないのは確認失敗として扱い、再試行を出す。
  if (status.state === 'signed_out') throw new Error('not signed in');
  return status;
}

const STATUS_LABEL: Record<DeviceStatus['state'], string> = {
  unsupported: 'この端末では利用できません',
  blocked: '通知がブロックされています',
  registered: 'この端末で登録済み',
  unregistered: '未登録',
};

/** headingLevel はページの見出しの並びに合わせる（管理画面の通知設定は h3 の下＝h4、マイページは h2 の下＝h3）。 */
export default function PushDeviceRegistration({ headingLevel = 'h4' }: { headingLevel?: 'h3' | 'h4' } = {}) {
  const Heading = headingLevel;
  const { subscribe, unsubscribe, busy, error } = usePushSubscription();
  // 状態は「どの読み込み回の結果か」と一緒に持ち、今の回の結果が来るまでは確認中として描く
  // （effect の中で同期的に「確認中」を立てると最初のフレームに間に合わないため）。
  const [checkKey, setCheckKey] = useState(0);
  const [result, setResult] = useState<{ key: number; status: DeviceStatus | null } | null>(null);
  const recheck = () => setCheckKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    readDeviceStatus()
      .then((status) => { if (!cancelled) setResult({ key: checkKey, status }); })
      .catch(() => { if (!cancelled) setResult({ key: checkKey, status: null }); });
    return () => { cancelled = true; };
  }, [checkKey]);

  const checking = result?.key !== checkKey;
  const status = checking ? null : result?.status ?? null;

  const handleSubscribe = async () => {
    await subscribe();
    recheck();
  };
  const handleUnsubscribe = async () => {
    await unsubscribe();
    recheck();
  };

  return (
    <section aria-labelledby="push-device-heading" className="border-t border-gray-100 pt-4 mt-4">
      <Heading id="push-device-heading" className="text-sm font-bold text-gray-800">この端末のプッシュ通知</Heading>
      <p className="text-xs text-gray-600 mt-1">
        通知を受け取れる端末はアカウントごとに1台です。別の端末で登録すると、前に登録した端末には届かなくなります。
      </p>
      {/* ログアウト・アカウント切替・退会のたびにこの端末の登録は外れる（releaseThisDevicePush）。
          黙って届かなくなると気づく手がかりが無いので、ここに書いておく。 */}
      <p className="text-xs text-gray-600 mt-1">
        ログアウトすると、この端末の通知は解除されます。もう一度ログインしたら、改めて登録してください。
      </p>

      {checking ? (
        <p className="text-sm text-gray-600 mt-3" role="status">登録状況を確認中...</p>
      ) : status === null ? (
        <div className="mt-3 text-sm text-red-700" role="alert">
          登録状況を確認できませんでした。
          <button type="button" onClick={recheck} className="ml-2 font-bold underline">再試行</button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-gray-700">
            状態：<span className="font-bold" data-testid="push-device-status">{STATUS_LABEL[status.state]}</span>
          </p>
          {status.state === 'unsupported' && (
            <p className="text-xs text-gray-600">お使いのブラウザがプッシュ通知に対応していないか、通知の準備が整っていません。別のブラウザ（スマートフォンの場合はホーム画面に追加したアプリ）でお試しください。</p>
          )}
          {status.state === 'blocked' && (
            <p className="text-xs text-gray-600">ブラウザのサイト設定で、このサイトの通知を「許可」に変更してから、もう一度お試しください。</p>
          )}
          {status.state === 'unregistered' && status.otherDevice && (
            <p className="text-xs text-gray-600">別の端末が登録されています。この端末を登録すると、通知はこの端末にだけ届くようになります。</p>
          )}
          {status.state === 'unregistered' && (
            <button type="button" onClick={handleSubscribe} disabled={busy} className="btn-primary text-sm py-2! px-4!">
              {busy ? '登録中...' : 'この端末で通知を受け取る'}
            </button>
          )}
          {status.state === 'registered' && (
            <button
              type="button"
              onClick={handleUnsubscribe}
              disabled={busy}
              className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {busy ? '解除中...' : 'この端末の通知を解除'}
            </button>
          )}
        </div>
      )}

      {error === 'subscribe' && <p className="text-xs text-red-700 mt-2" role="alert">通知の登録に失敗しました。時間をおいて再度お試しください。</p>}
      {error === 'signed_out' && <p className="text-xs text-red-700 mt-2" role="alert">ログインを確認できませんでした。ログインし直してから、もう一度お試しください。</p>}
      {error === 'unsubscribe' && <p className="text-xs text-red-700 mt-2" role="alert">通知の解除に失敗しました。時間をおいて再度お試しください。</p>}
    </section>
  );
}
