'use client';

import { useState } from 'react';

const TREATMENTS = ['鍼灸治療', '灸治療', '鍼治療', 'マッサージ', '変形徒手矯正術'];
const DISEASES = ['神経痛', '腰痛症', '頸腕症候群', '五十肩', '関節リウマチ', '頸椎捻挫後遺症', 'その他'];

interface FormState {
  // 患者情報
  patient_name: string;
  patient_kana: string;
  patient_dob: string;
  patient_gender: string;
  patient_address: string;
  patient_phone: string;
  // 保険情報
  insurer_name: string;
  insurer_number: string;
  insured_number: string;
  symbol_number: string;
  // 治療情報
  treatment_type: string;
  disease_name: string;
  disease_other: string;
  disease_side: string;
  onset_date: string;
  treatment_start: string;
  treatment_count: number;
  amount_per_session: number;
  // 施術者情報
  practitioner_name: string;
  facility_name: string;
  facility_address: string;
  facility_phone: string;
  registration_number: string;
  // 備考
  notes: string;
}

const EMPTY: FormState = {
  patient_name: '', patient_kana: '', patient_dob: '', patient_gender: '男',
  patient_address: '', patient_phone: '',
  insurer_name: '', insurer_number: '', insured_number: '', symbol_number: '',
  treatment_type: '鍼灸治療', disease_name: '腰痛症', disease_other: '',
  disease_side: '両側', onset_date: '', treatment_start: '',
  treatment_count: 1, amount_per_session: 0,
  practitioner_name: '', facility_name: '', facility_address: '', facility_phone: '',
  registration_number: '', notes: '',
};

export default function InsurancePage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const totalAmount = form.treatment_count * form.amount_per_session;
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">保険請求書（療養費支給申請書）</h1>
          <p className="text-xs text-gray-400 mt-0.5">鍼灸・マッサージ施術の療養費申請書を作成・印刷</p>
        </div>
        <button onClick={() => window.print()}
          className="print:hidden flex items-center gap-2 px-4 py-2 bg-sky-500 text-white rounded-lg text-sm font-medium hover:bg-sky-600">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          印刷
        </button>
      </div>

      {/* 入力フォーム */}
      <div className="print:hidden space-y-6">
        {/* 患者情報 */}
        <section className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
          <h2 className="font-bold text-sm text-gray-700 border-b pb-2">患者情報</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">氏名 <span className="text-red-500">*</span></label>
              <input value={form.patient_name} onChange={f('patient_name')} className="input" placeholder="山田 太郎" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">フリガナ</label>
              <input value={form.patient_kana} onChange={f('patient_kana')} className="input" placeholder="ヤマダ タロウ" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">生年月日</label>
              <input type="date" value={form.patient_dob} onChange={f('patient_dob')} className="input" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">性別</label>
              <select value={form.patient_gender} onChange={f('patient_gender')} className="input">
                <option>男</option><option>女</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500 block mb-1">住所</label>
              <input value={form.patient_address} onChange={f('patient_address')} className="input" placeholder="大阪府豊中市..." />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">電話番号</label>
              <input value={form.patient_phone} onChange={f('patient_phone')} className="input" placeholder="06-xxxx-xxxx" />
            </div>
          </div>
        </section>

        {/* 保険情報 */}
        <section className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
          <h2 className="font-bold text-sm text-gray-700 border-b pb-2">保険情報</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">保険者名</label>
              <input value={form.insurer_name} onChange={f('insurer_name')} className="input" placeholder="〇〇健康保険組合" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">保険者番号</label>
              <input value={form.insurer_number} onChange={f('insurer_number')} className="input" placeholder="06..." />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">被保険者証記号</label>
              <input value={form.symbol_number} onChange={f('symbol_number')} className="input" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">被保険者証番号</label>
              <input value={form.insured_number} onChange={f('insured_number')} className="input" />
            </div>
          </div>
        </section>

        {/* 治療情報 */}
        <section className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
          <h2 className="font-bold text-sm text-gray-700 border-b pb-2">施術情報</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">施術種別</label>
              <select value={form.treatment_type} onChange={f('treatment_type')} className="input">
                {TREATMENTS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">傷病名</label>
              <select value={form.disease_name} onChange={f('disease_name')} className="input">
                {DISEASES.map((d) => <option key={d}>{d}</option>)}
              </select>
            </div>
            {form.disease_name === 'その他' && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">傷病名（その他）</label>
                <input value={form.disease_other} onChange={f('disease_other')} className="input" />
              </div>
            )}
            <div>
              <label className="text-xs text-gray-500 block mb-1">患部</label>
              <select value={form.disease_side} onChange={f('disease_side')} className="input">
                {['両側', '左側', '右側', '頸部', '腰部', '上肢', '下肢'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">発症年月日</label>
              <input type="date" value={form.onset_date} onChange={f('onset_date')} className="input" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">施術開始日</label>
              <input type="date" value={form.treatment_start} onChange={f('treatment_start')} className="input" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">施術回数</label>
              <input type="number" value={form.treatment_count} onChange={f('treatment_count')} className="input" min={1} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">1回あたり料金（円）</label>
              <input type="number" value={form.amount_per_session} onChange={f('amount_per_session')} className="input" min={0} />
            </div>
          </div>
        </section>

        {/* 施術者情報 */}
        <section className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
          <h2 className="font-bold text-sm text-gray-700 border-b pb-2">施術者情報</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">施術者氏名</label>
              <input value={form.practitioner_name} onChange={f('practitioner_name')} className="input" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">施術所名</label>
              <input value={form.facility_name} onChange={f('facility_name')} className="input" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500 block mb-1">施術所住所</label>
              <input value={form.facility_address} onChange={f('facility_address')} className="input" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">電話番号</label>
              <input value={form.facility_phone} onChange={f('facility_phone')} className="input" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">施術者登録番号</label>
              <input value={form.registration_number} onChange={f('registration_number')} className="input" />
            </div>
          </div>
        </section>

        <div>
          <label className="text-xs text-gray-500 block mb-1">備考</label>
          <textarea value={form.notes} onChange={f('notes')} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {/* 印刷用プレビュー */}
      <div className="bg-white border border-gray-300 rounded-xl p-8 print:p-0 print:border-0 print:rounded-none print:shadow-none">
        <style jsx>{`
          .input { @apply w-full border border-gray-300 rounded-lg px-3 py-2 text-sm; }
          @media print {
            .print-table td, .print-table th { border: 1px solid #999; padding: 4px 8px; font-size: 11px; }
          }
        `}</style>

        <div className="text-center mb-6">
          <h2 className="text-xl font-bold">療養費支給申請書</h2>
          <p className="text-sm text-gray-500">（{form.treatment_type}）</p>
        </div>

        <p className="text-right text-sm mb-4">申請日: {today}</p>

        <table className="w-full border-collapse text-sm mb-4 print-table">
          <tbody>
            <tr>
              <th className="bg-gray-50 w-32 text-left">患者氏名</th>
              <td>{form.patient_name} {form.patient_kana && `（${form.patient_kana}）`}</td>
              <th className="bg-gray-50 w-24 text-left">性別</th>
              <td>{form.patient_gender}</td>
            </tr>
            <tr>
              <th className="bg-gray-50 text-left">生年月日</th>
              <td>{form.patient_dob ? new Date(form.patient_dob).toLocaleDateString('ja-JP') : ''}</td>
              <th className="bg-gray-50 text-left">電話</th>
              <td>{form.patient_phone}</td>
            </tr>
            <tr>
              <th className="bg-gray-50 text-left">住所</th>
              <td colSpan={3}>{form.patient_address}</td>
            </tr>
            <tr>
              <th className="bg-gray-50 text-left">保険者名</th>
              <td>{form.insurer_name}</td>
              <th className="bg-gray-50 text-left">保険者番号</th>
              <td>{form.insurer_number}</td>
            </tr>
            <tr>
              <th className="bg-gray-50 text-left">記号・番号</th>
              <td colSpan={3}>{form.symbol_number} ・ {form.insured_number}</td>
            </tr>
            <tr>
              <th className="bg-gray-50 text-left">傷病名</th>
              <td>{form.disease_name === 'その他' ? form.disease_other : form.disease_name}（{form.disease_side}）</td>
              <th className="bg-gray-50 text-left">発症日</th>
              <td>{form.onset_date ? new Date(form.onset_date).toLocaleDateString('ja-JP') : ''}</td>
            </tr>
            <tr>
              <th className="bg-gray-50 text-left">施術開始日</th>
              <td>{form.treatment_start ? new Date(form.treatment_start).toLocaleDateString('ja-JP') : ''}</td>
              <th className="bg-gray-50 text-left">施術回数</th>
              <td>{form.treatment_count}回</td>
            </tr>
            <tr>
              <th className="bg-gray-50 text-left">1回あたり料金</th>
              <td>¥{form.amount_per_session.toLocaleString()}</td>
              <th className="bg-gray-50 text-left font-bold">合計請求額</th>
              <td className="font-bold text-lg">¥{totalAmount.toLocaleString()}</td>
            </tr>
            <tr>
              <th className="bg-gray-50 text-left">施術者</th>
              <td>{form.practitioner_name}</td>
              <th className="bg-gray-50 text-left">登録番号</th>
              <td>{form.registration_number}</td>
            </tr>
            <tr>
              <th className="bg-gray-50 text-left">施術所</th>
              <td>{form.facility_name}</td>
              <th className="bg-gray-50 text-left">電話</th>
              <td>{form.facility_phone}</td>
            </tr>
            <tr>
              <th className="bg-gray-50 text-left">施術所住所</th>
              <td colSpan={3}>{form.facility_address}</td>
            </tr>
            {form.notes && (
              <tr>
                <th className="bg-gray-50 text-left">備考</th>
                <td colSpan={3}>{form.notes}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-8 flex justify-between items-end">
          <div className="text-xs text-gray-500">
            <p>※ 医師の同意書を必ず添付してください</p>
            <p>※ 領収書は原本を添付してください</p>
          </div>
          <div className="border-t border-gray-400 w-48 text-center text-xs pt-1 text-gray-500">患者署名・捺印</div>
        </div>
      </div>
    </div>
  );
}
