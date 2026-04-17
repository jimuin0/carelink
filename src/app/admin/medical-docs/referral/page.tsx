'use client';

import { useState } from 'react';

interface FormState {
  // 患者情報
  patient_name: string;
  patient_kana: string;
  patient_dob: string;
  patient_gender: string;
  patient_address: string;
  // 紹介先
  to_facility: string;
  to_department: string;
  to_doctor: string;
  // 自院情報
  from_facility: string;
  from_address: string;
  from_phone: string;
  from_doctor: string;
  from_registration: string;
  // 診療情報
  chief_complaint: string;
  diagnosis: string;
  treatment_summary: string;
  referral_reason: string;
  medications: string;
  exam_results: string;
  notes: string;
  referral_date: string;
  urgency: string;
}

const EMPTY: FormState = {
  patient_name: '', patient_kana: '', patient_dob: '', patient_gender: '男', patient_address: '',
  to_facility: '', to_department: '', to_doctor: '',
  from_facility: '', from_address: '', from_phone: '', from_doctor: '', from_registration: '',
  chief_complaint: '', diagnosis: '', treatment_summary: '', referral_reason: '',
  medications: '', exam_results: '', notes: '',
  referral_date: new Date().toISOString().slice(0, 10),
  urgency: '通常',
};

export default function ReferralPage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const referralDate = form.referral_date ? new Date(form.referral_date).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">紹介状（診療情報提供書）</h1>
          <p className="text-xs text-gray-400 mt-0.5">医療機関への患者紹介状を作成・印刷</p>
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
      <div className="print:hidden space-y-5">
        {/* 緊急度 */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700">緊急度:</span>
          {['通常', '準緊急', '緊急'].map((u) => (
            <button key={u} onClick={() => setForm({ ...form, urgency: u })}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                form.urgency === u
                  ? u === '緊急' ? 'bg-red-500 text-white border-red-500'
                    : u === '準緊急' ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-sky-500 text-white border-sky-500'
                  : 'bg-white text-gray-500 border-gray-300'
              }`}>{u}</button>
          ))}
          <div className="ml-auto">
            <label className="text-xs text-gray-500 mr-2">紹介日</label>
            <input type="date" value={form.referral_date} onChange={f('referral_date')} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
          </div>
        </div>

        {/* 患者情報 */}
        <section className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
          <h2 className="font-bold text-sm text-gray-700 border-b pb-2">患者情報</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">氏名 <span className="text-red-500">*</span></label>
              <input value={form.patient_name} onChange={f('patient_name')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="山田 太郎" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">フリガナ</label>
              <input value={form.patient_kana} onChange={f('patient_kana')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">生年月日</label>
              <input type="date" value={form.patient_dob} onChange={f('patient_dob')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">性別</label>
              <select value={form.patient_gender} onChange={f('patient_gender')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option>男</option><option>女</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500 block mb-1">住所</label>
              <input value={form.patient_address} onChange={f('patient_address')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
        </section>

        {/* 紹介先 */}
        <section className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
          <h2 className="font-bold text-sm text-gray-700 border-b pb-2">紹介先</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">医療機関名</label>
              <input value={form.to_facility} onChange={f('to_facility')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="○○病院" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">診療科</label>
              <input value={form.to_department} onChange={f('to_department')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="整形外科" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">担当医（任意）</label>
              <input value={form.to_doctor} onChange={f('to_doctor')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="先生" />
            </div>
          </div>
        </section>

        {/* 診療情報 */}
        <section className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
          <h2 className="font-bold text-sm text-gray-700 border-b pb-2">診療情報</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">主訴</label>
              <input value={form.chief_complaint} onChange={f('chief_complaint')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="腰痛・下肢しびれ" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">傷病名・病名</label>
              <input value={form.diagnosis} onChange={f('diagnosis')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="腰椎椎間板ヘルニア疑い" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500 block mb-1">紹介理由</label>
              <textarea value={form.referral_reason} onChange={f('referral_reason')} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="MRI検査およびより専門的な治療をお願いしたく、ご紹介申し上げます。" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500 block mb-1">これまでの経過・施術内容</label>
              <textarea value={form.treatment_summary} onChange={f('treatment_summary')} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="3ヶ月前より腰痛訴え。鍼灸治療週2回施行するも改善乏しい。" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500 block mb-1">検査所見・画像所見</label>
              <textarea value={form.exam_results} onChange={f('exam_results')} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500 block mb-1">投薬・処置</label>
              <textarea value={form.medications} onChange={f('medications')} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="なし" />
            </div>
          </div>
        </section>

        {/* 自院情報 */}
        <section className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
          <h2 className="font-bold text-sm text-gray-700 border-b pb-2">自院情報</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">施術所名</label>
              <input value={form.from_facility} onChange={f('from_facility')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">施術者名</label>
              <input value={form.from_doctor} onChange={f('from_doctor')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500 block mb-1">住所</label>
              <input value={form.from_address} onChange={f('from_address')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">電話番号</label>
              <input value={form.from_phone} onChange={f('from_phone')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">登録番号</label>
              <input value={form.from_registration} onChange={f('from_registration')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
        </section>

        <div>
          <label className="text-xs text-gray-500 block mb-1">備考</label>
          <textarea value={form.notes} onChange={f('notes')} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {/* 印刷プレビュー */}
      <div className="bg-white border border-gray-300 rounded-xl p-8 print:p-8 print:border-0">
        <div className="flex justify-between items-start mb-6">
          <div>
            {form.urgency !== '通常' && (
              <span className={`inline-block px-3 py-1 rounded text-sm font-bold mb-2 ${form.urgency === '緊急' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                【{form.urgency}】
              </span>
            )}
            <h2 className="text-2xl font-bold">診療情報提供書（紹介状）</h2>
          </div>
          <div className="text-sm text-gray-600 text-right">
            <p>{referralDate}</p>
          </div>
        </div>

        <div className="mb-6 p-3 border border-gray-200 rounded">
          <p className="text-sm">
            <span className="font-medium">{form.to_facility}</span>
            {form.to_department && <span> {form.to_department}</span>}
            {form.to_doctor && <span> {form.to_doctor} 先生</span>}
            &nbsp;御机下
          </p>
        </div>

        <p className="text-sm mb-6">
          下記の患者様をご紹介申し上げます。ご高診のほどよろしくお願い申し上げます。
        </p>

        <table className="w-full border-collapse text-sm mb-4" style={{ borderCollapse: 'collapse' }}>
          <tbody>
            <tr style={{ border: '1px solid #ccc' }}>
              <th style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 10px', width: '130px', textAlign: 'left' }}>患者氏名</th>
              <td style={{ border: '1px solid #ccc', padding: '6px 10px' }}>
                {form.patient_name}
                {form.patient_kana && <span className="text-gray-500">（{form.patient_kana}）</span>}
              </td>
              <th style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 10px', width: '80px', textAlign: 'left' }}>性別</th>
              <td style={{ border: '1px solid #ccc', padding: '6px 10px' }}>{form.patient_gender}</td>
            </tr>
            <tr style={{ border: '1px solid #ccc' }}>
              <th style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 10px', textAlign: 'left' }}>生年月日</th>
              <td style={{ border: '1px solid #ccc', padding: '6px 10px' }}>{form.patient_dob ? new Date(form.patient_dob).toLocaleDateString('ja-JP') : ''}</td>
              <th style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 10px', textAlign: 'left' }}>住所</th>
              <td style={{ border: '1px solid #ccc', padding: '6px 10px' }}>{form.patient_address}</td>
            </tr>
            <tr style={{ border: '1px solid #ccc' }}>
              <th style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 10px', textAlign: 'left' }}>主訴</th>
              <td colSpan={3} style={{ border: '1px solid #ccc', padding: '6px 10px' }}>{form.chief_complaint}</td>
            </tr>
            <tr style={{ border: '1px solid #ccc' }}>
              <th style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 10px', textAlign: 'left' }}>傷病名</th>
              <td colSpan={3} style={{ border: '1px solid #ccc', padding: '6px 10px' }}>{form.diagnosis}</td>
            </tr>
            <tr style={{ border: '1px solid #ccc' }}>
              <th style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 10px', textAlign: 'left' }}>紹介理由</th>
              <td colSpan={3} style={{ border: '1px solid #ccc', padding: '6px 10px', whiteSpace: 'pre-wrap' }}>{form.referral_reason}</td>
            </tr>
            <tr style={{ border: '1px solid #ccc' }}>
              <th style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 10px', textAlign: 'left' }}>経過・施術内容</th>
              <td colSpan={3} style={{ border: '1px solid #ccc', padding: '6px 10px', whiteSpace: 'pre-wrap' }}>{form.treatment_summary}</td>
            </tr>
            {form.exam_results && (
              <tr style={{ border: '1px solid #ccc' }}>
                <th style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 10px', textAlign: 'left' }}>検査所見</th>
                <td colSpan={3} style={{ border: '1px solid #ccc', padding: '6px 10px', whiteSpace: 'pre-wrap' }}>{form.exam_results}</td>
              </tr>
            )}
            <tr style={{ border: '1px solid #ccc' }}>
              <th style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 10px', textAlign: 'left' }}>投薬・処置</th>
              <td colSpan={3} style={{ border: '1px solid #ccc', padding: '6px 10px' }}>{form.medications || 'なし'}</td>
            </tr>
            {form.notes && (
              <tr style={{ border: '1px solid #ccc' }}>
                <th style={{ border: '1px solid #ccc', background: '#f5f5f5', padding: '6px 10px', textAlign: 'left' }}>備考</th>
                <td colSpan={3} style={{ border: '1px solid #ccc', padding: '6px 10px', whiteSpace: 'pre-wrap' }}>{form.notes}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-8 flex justify-end">
          <div className="text-sm text-right space-y-1">
            <p className="font-medium">{form.from_facility}</p>
            <p>{form.from_address}</p>
            <p>{form.from_phone && `TEL: ${form.from_phone}`}</p>
            <p>{form.from_doctor}</p>
            {form.from_registration && <p className="text-gray-500 text-xs">登録番号: {form.from_registration}</p>}
            <div className="mt-4 border-t border-gray-400 pt-2 w-40 ml-auto text-center text-xs text-gray-500">署名・捺印</div>
          </div>
        </div>
      </div>
    </div>
  );
}
