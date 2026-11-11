/**
 * 医療機関の登録値と検索URLの単一ソース。
 * 既存の business_type（単一選択）で、施設区分または主な診療科を登録する。
 * 複数科を掲げる施設は病院・クリニックを選び、紹介文に各診療科を記載する。
 */
export const medicalBusinessTypeSlugs: Readonly<Record<string, string>> = {
  hospital: '病院',
  'general-hospital': '総合病院',
  'general-clinic': '診療所・クリニック（複数診療科）',
  'internal-medicine': '内科',
  'respiratory-medicine': '呼吸器内科',
  'cardiology': '循環器内科',
  'gastroenterology': '消化器内科',
  'diabetes-medicine': '糖尿病内科',
  'nephrology': '腎臓内科',
  'neurology': '脳神経内科',
  'surgery': '外科',
  'orthopedic-surgery': '整形外科',
  'neurosurgery': '脳神経外科',
  'plastic-surgery': '形成外科',
  'pediatrics': '小児科',
  'otorhinolaryngology': '耳鼻咽喉科',
  'ophthalmology': '眼科',
  'dermatology': '皮膚科',
  'urology': '泌尿器科',
  'obstetrics-gynecology': '産婦人科',
  'gynecology': '婦人科',
  'psychiatry': '精神科',
  'psychosomatic-medicine': '心療内科',
  'allergology': 'アレルギー科',
  'rheumatology': 'リウマチ科',
  'rehabilitation-medicine': 'リハビリテーション科',
  'dentistry': '歯科',
  'pediatric-dentistry': '小児歯科',
  'orthodontics': '矯正歯科',
  'oral-surgery': '歯科口腔外科',
  'other-medical-clinic': 'その他の医療機関',
};

export const medicalBusinessTypes: readonly string[] = Object.values(medicalBusinessTypeSlugs);

/** 業種の選択欄で、医療の区分をまとめて出す 1 行の値（医療を選んだ直後の既定値も兼ねる）。 */
export const MEDICAL_BUSINESS_TYPE_DEFAULT = 'その他の医療機関';

/**
 * 業種の選択欄に出す「医療機関」1 行の value。いま医療の区分が選ばれていればその値、無ければ既定値。
 *
 * 🔴 区分ごとに <option hidden> を並べて選択値を保つ作りは、iPhone の Safari が hidden を無視して
 * 「医療機関」が区分の数だけ並ぶ（2026年11月11日）。行は常に 1 つにし、value だけを今の区分に合わせる。
 */
export function medicalBusinessTypeOptionValue(current: string): string {
  return medicalBusinessTypes.includes(current) ? current : MEDICAL_BUSINESS_TYPE_DEFAULT;
}
