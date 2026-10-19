import type { Metadata } from 'next';
import { SbPageHeader } from '@/components/admin/SbUi';

// admin/layout の title.template '%s | 管理画面 | CareLink' が自動付与するため、ここではページ名のみ（二重化防止）。
export const metadata: Metadata = { title: 'メール配信設定' };

export default function EmailSetupPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <SbPageHeader title="メール配信設定" description="DKIM/SPF/DMARC の設定とメール到達率の改善ガイド" />

      {/* Current config */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-bold text-gray-800">配信設定の確認項目</h2>
        <p className="text-sm text-gray-600">このページは設定ガイドです。DNSや送信ドメインの実状態は照合していません。設定例をそのまま適用せず、ResendとDNS管理画面で現在の設定をご確認ください。</p>
        <div className="space-y-3">
          {[
            { label: 'メール配信サービス', value: 'Resend' },
            { label: '送信ドメイン', value: 'carelink-jp.com' },
            { label: 'SPFレコード', value: 'Resendで指定されたSPFレコードを確認' },
            { label: 'DKIM', value: 'Resendで指定されたDKIMレコードを確認' },
            { label: 'DMARC', value: '既存のDMARCポリシーとレポート受信先を確認'},
          ].map((item) => (
            <div key={item.label} className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-800">{item.label}</p>
                <code className="text-xs text-gray-500">{item.value}</code>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full font-bold shrink-0 bg-gray-100 text-gray-700">
                確認項目
              </span>
            </div>
          ))}
        </div>
      </div>

      <a href="https://resend.com/docs/dashboard/domains/introduction" target="_blank" rel="noopener noreferrer" className="text-sm text-sky-600 underline">Resend公式のドメイン設定ガイド</a>

      {/* Setup steps */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-6">
        <h2 className="font-bold text-gray-800">DKIM/SPF/DMARC 設定手順</h2>

        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-bold text-sky-700 mb-2">Step 1: SPF レコード設定</h3>
            <p className="text-xs text-gray-600 mb-2">
              Resendで対象ドメインに表示されたレコードの名前・種類・値を確認します。既存のDNS設定を推測で上書きせず、変更前に現在の設定との整合を確認してください。
            </p>
            <div className="bg-gray-900 rounded-lg p-3">
              <code className="text-xs text-green-400 font-mono">
                <span className="text-gray-400"># ホスト名: </span>Resendに表示されたホスト名<br />
                <span className="text-gray-400"># タイプ: </span>TXT<br />
                <span className="text-gray-400"># 値: </span>Resendに表示されたSPF TXT値
              </code>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-sky-700 mb-2">Step 2: DKIM 設定（Resend）</h3>
            <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
              <li>Resend ダッシュボード（resend.com）にログイン</li>
              <li>対象の送信ドメインを開き、指定されたレコードを確認</li>
              <li>表示されたDKIM TXTレコードをDNSに追加</li>
              <li>Verify ボタンを押して確認</li>
            </ol>
            <div className="mt-2 bg-gray-900 rounded-lg p-3">
              <code className="text-xs text-green-400 font-mono">
                <span className="text-gray-400"># ホスト名: </span>Resendに表示されたDKIMホスト名<br />
                <span className="text-gray-400"># タイプ: </span>TXT<br />
                <span className="text-gray-400"># 値: </span>Resendのダッシュボードで確認
              </code>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-sky-700 mb-2">Step 3: DMARC 設定</h3>
            <p className="text-xs text-gray-600 mb-2">
              既存ポリシーとレポートを確認し、適用するポリシーは運用担当者が判断してください。レポート受信先は、実際に受信・確認できるアドレスを指定します。
            </p>
            <div className="bg-gray-900 rounded-lg p-3">
              <code className="text-xs text-green-400 font-mono">
                <span className="text-gray-400"># ホスト名: </span>_dmarc.carelink-jp.com<br />
                <span className="text-gray-400"># タイプ: </span>TXT<br />
                <span className="text-gray-400"># 値: </span>運用方針と受信先を確認して決定
              </code>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-sky-700 mb-2">Step 4: メール到達率テスト</h3>
            <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
              <li><a href="https://www.mail-tester.com/" target="_blank" rel="noopener noreferrer" className="text-sky-600 underline">mail-tester.com</a> でスコア確認（10/10を目標）</li>
              <li><a href="https://mxtoolbox.com/emailhealth/" target="_blank" rel="noopener noreferrer" className="text-sky-600 underline">MXToolbox</a> でSPF/DKIM/DMARCを確認</li>
              <li>メールヘッダーでSPF・DKIM・DMARCの検証結果と送信ドメインの整合を確認</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Email monitoring */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-bold text-gray-800">メール到達率の確認目安</h2>
        <p className="text-xs text-gray-600">
          以下は運用上の目安です。この画面では実績や到達率を照合していません。実際の配信記録と受信結果を確認してください。
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
