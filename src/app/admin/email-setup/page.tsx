import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'メール配信設定 | 管理画面 | CareLink' };

export default function EmailSetupPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">メール配信設定</h1>
        <p className="text-xs text-gray-400 mt-0.5">DKIM/SPF/DMARC の設定とメール到達率の改善ガイド</p>
      </div>

      {/* Current config */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-bold text-gray-800">現在の配信設定</h2>
        <div className="space-y-3">
          {[
            { label: 'メール配信サービス', value: 'Resend', status: 'ok' },
            { label: '送信ドメイン', value: 'carelink-jp.com', status: 'ok' },
            { label: 'SPFレコード', value: 'v=spf1 include:_spf.resend.com ~all', status: 'pending' },
            { label: 'DKIM', value: 'Resend DKIM設定が必要', status: 'pending' },
            { label: 'DMARC', value: 'v=DMARC1; p=none; rua=mailto:...', status: 'pending' },
          ].map((item) => (
            <div key={item.label} className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-800">{item.label}</p>
                <code className="text-xs text-gray-500">{item.value}</code>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-bold shrink-0 ${
                item.status === 'ok' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {item.status === 'ok' ? '設定済み' : '要設定'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Setup steps */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-6">
        <h2 className="font-bold text-gray-800">DKIM/SPF/DMARC 設定手順</h2>

        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-bold text-sky-700 mb-2">Step 1: SPF レコード設定</h3>
            <p className="text-xs text-gray-600 mb-2">
              お使いのDNSプロバイダー（お名前.com, Cloudflare等）で以下のTXTレコードを追加:
            </p>
            <div className="bg-gray-900 rounded-lg p-3">
              <code className="text-xs text-green-400 font-mono">
                <span className="text-gray-400"># ホスト名: </span>@ または carelink-jp.com<br />
                <span className="text-gray-400"># タイプ: </span>TXT<br />
                <span className="text-gray-400"># 値: </span>v=spf1 include:_spf.resend.com ~all
              </code>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-sky-700 mb-2">Step 2: DKIM 設定（Resend）</h3>
            <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
              <li>Resend ダッシュボード（resend.com）にログイン</li>
              <li>Settings → Domains → Add Domain → carelink-jp.com を追加</li>
              <li>表示されたDKIM TXTレコードをDNSに追加</li>
              <li>Verify ボタンを押して確認</li>
            </ol>
            <div className="mt-2 bg-gray-900 rounded-lg p-3">
              <code className="text-xs text-green-400 font-mono">
                <span className="text-gray-400"># ホスト名: </span>resend._domainkey.carelink-jp.com<br />
                <span className="text-gray-400"># タイプ: </span>TXT<br />
                <span className="text-gray-400"># 値: </span>Resendのダッシュボードで確認
              </code>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-sky-700 mb-2">Step 3: DMARC 設定</h3>
            <p className="text-xs text-gray-600 mb-2">
              まず監視モード（p=none）から始めて、レポートを確認してから p=quarantine → p=reject に変更します:
            </p>
            <div className="bg-gray-900 rounded-lg p-3">
              <code className="text-xs text-green-400 font-mono">
                <span className="text-gray-400"># ホスト名: </span>_dmarc.carelink-jp.com<br />
                <span className="text-gray-400"># タイプ: </span>TXT<br />
                <span className="text-gray-400"># 値（初期）: </span>v=DMARC1; p=none; rua=mailto:dmarc@carelink-jp.com; ruf=mailto:dmarc@carelink-jp.com; fo=1
              </code>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-sky-700 mb-2">Step 4: メール到達率テスト</h3>
            <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
              <li><a href="https://www.mail-tester.com/" target="_blank" rel="noopener noreferrer" className="text-sky-600 underline">mail-tester.com</a> でスコア確認（10/10を目標）</li>
              <li><a href="https://mxtoolbox.com/emailhealth/" target="_blank" rel="noopener noreferrer" className="text-sky-600 underline">MXToolbox</a> でSPF/DKIM/DMARCを確認</li>
              <li>Gmailのヘッダー確認で「mailed-by」「signed-by」が carelink-jp.com になっているか確認</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Email monitoring */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-bold text-gray-800">メール到達率モニタリング</h2>
        <p className="text-xs text-gray-600">
          Resend ダッシュボードで以下の指標を定期確認してください:
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: '配信率', target: '> 98%', desc: 'バウンスが少ないか' },
            { label: '開封率', target: '> 20%', desc: '件名の改善余地' },
            { label: 'スパム率', target: '< 0.1%', desc: 'Gmailパンドラ対策' },
            { label: 'バウンス率', target: '< 2%', desc: '無効アドレスの除去' },
          ].map((m) => (
            <div key={m.label} className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-bold text-gray-800">{m.label}</p>
              <p className="text-lg font-bold text-sky-600">{m.target}</p>
              <p className="text-xs text-gray-500">{m.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-amber-50 rounded-xl p-5 text-xs text-amber-800 space-y-1">
        <p className="font-bold">重要</p>
        <p>• DNS変更は反映に最大48時間かかります</p>
        <p>• DMARCのp=rejectは十分テストしてから適用してください（正規メールも届かなくなるリスクあり）</p>
        <p>• Googleは2024年2月より1日5000件以上送信するドメインにDMARC設定を必須化しています</p>
      </div>
    </div>
  );
}
