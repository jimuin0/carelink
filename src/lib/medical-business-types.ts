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
