import Link from 'next/link';

const steps = [
  { number: '1', title: '店舗ごとに申し込む', detail: '掲載申込フォームに店舗の情報を入力し、送信します。受付番号を控えてください。' },
  { number: '2', title: 'アカウントで引き継ぐ', detail: '申込と同じメールアドレスでアカウントを作成し、確認メールの手続きを済ませます。すでにアカウントがある場合はログインします。' },
  { number: '3', title: '書類を提出する', detail: '管理画面の施設設定で店舗確認書類を提出します。運営が書類と申請者の管理権限を確認します。' },
  { number: '4', title: '情報を整えて公開する', detail: '確認後、店舗名・所在地・曜日ごとの営業時間と定休日を設定し、管理画面から公開します。' },
];

export default function RegistrationGuidePage() {
  return <main className="theme-ecru min-h-screen bg-(--ecru-bg) text-(--ecru-text)">
    <div className="section-container mx-auto max-w-3xl py-10 sm:py-14">
      <Link href="/register" className="text-sm underline underline-offset-4">掲載申込に戻る</Link>
      <h1 className="mt-6 font-(family-name:--font-serif-jp) text-2xl sm:text-3xl">掲載までの流れ</h1>
      <p className="mt-3 leading-relaxed">お申し込みから公開までは、次の4つの手順です。</p>
      <ol aria-label="掲載までの4つの手順" className="mt-8 space-y-3">
        {steps.map((step, index) => <li key={step.number}>
          <div className="flex gap-4 rounded-xl border border-(--ecru-line) bg-(--ecru-surface) p-4 sm:p-5">
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--primary) font-bold text-white">{step.number}</span>
            <div><h2 className="font-bold">{step.title}</h2><p className="mt-2 text-sm leading-relaxed">{step.detail}</p></div>
          </div>
          {index < steps.length - 1 && <div aria-hidden="true" className="pl-7 pt-2 text-(--ecru-muted)">↓</div>}
        </li>)}
      </ol>
      <section className="mt-10 border-t border-(--ecru-line) pt-6" aria-labelledby="multiple-shops">
        <h2 id="multiple-shops" className="text-lg font-bold">複数の店舗を掲載する場合</h2>
        <p className="mt-3 leading-relaxed">店舗ごとに申し込み、同じ確認済みメールアドレスのアカウントで各申込を引き継いでください。管理画面で店舗を切り替えられます。</p>
        <div className="mt-4 rounded-xl border border-(--ecru-line) bg-(--ecru-surface) p-4 text-center text-sm" aria-label="1つのアカウントで複数店舗を管理">
          <p className="font-bold">1つのアカウント</p>
          <p aria-hidden="true" className="my-2 text-(--ecru-muted)">↓</p>
          <p>店舗 1　・　店舗 2　・　店舗 3 …</p>
        </div>
      </section>
      <section className="mt-8 border-t border-(--ecru-line) pt-6" aria-labelledby="documents">
        <h2 id="documents" className="text-lg font-bold">確認書類について</h2>
        <p className="mt-3 leading-relaxed">開設届や営業許可の書類、店舗の賃貸借契約書、公共料金の請求書などから、店舗名・所在地・運営者を確認できる書類をご用意ください。内容によっては追加の確認をお願いする場合があります。</p>
        <p className="mt-3 text-sm leading-relaxed">PDF・JPEG・PNGに対応し、1ファイル10 MiBまでです。金額や口座番号など確認に不要な情報は隠してください。</p>
      </section>
      <section className="mt-8 border-t border-(--ecru-line) pt-6" aria-labelledby="listing-only">
        <h2 id="listing-only" className="text-lg font-bold">無料掲載だけでも利用できます</h2>
        <p className="mt-3 leading-relaxed">ネット予約の利用は任意です。申込やアカウント作成だけで有料プランの契約にはなりません。</p>
      </section>
      <p className="mt-8 text-sm leading-relaxed">受付状況が分からない場合や既存掲載の確認が必要な場合は、重複を避けるため再申込の前にお問い合わせください。</p>
      <Link href="/contact" className="mt-3 inline-block underline underline-offset-4">運営に問い合わせる</Link>
    </div>
  </main>;
}
