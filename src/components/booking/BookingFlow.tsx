'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import type { StaffProfile, FacilityMenu, Coupon, AvailableSlot } from '@/types';

type Step = 'menu' | 'datetime' | 'confirm';

/**
 * 予約フォームの合計金額を計算する純粋関数（TZ非依存の日付計算と同様、テスト容易化のため分離）。
 * 【2026年7月8日 恒久根治】旧実装は menuTotal===0（無料メニュー）で指名料を加算する前に
 * null を返していた。一方サーバー側(/api/booking)は menuTotal=0 でも serverTotalPrice(=0) != null
 * として指名スタッフの nomination_fee を加算した金額で確定させる（本番確認: price=0メニューは
 * 現状0件だが、追加された瞬間にクライアント/サーバーの計算が食い違う。金銭課金額はサーバー計算が
 * 正のため差額は生じないが、確認画面の合計金額が非表示になりポイント利用セクションも隠れる=
 * 使えるはずのポイントが使えないUX不整合になる）。menuTotal===0 の早期returnを外し、サーバーと
 * 同一ロジック（クーポン→指名料の順）で計算する。
 */
export function calculateBookingPrice(
  selectedMenus: FacilityMenu[],
  selectedCoupon: Coupon | null,
  selectedStaff: StaffProfile | null,
): number | null {
  if (selectedMenus.length === 0) return null;
  const menuTotal = selectedMenus.reduce((sum, m) => sum + (m.price || 0), 0);
  let price = menuTotal;
  if (selectedCoupon) {
    if (selectedCoupon.discount_type === 'fixed' && selectedCoupon.discount_value) {
      price = Math.max(0, price - selectedCoupon.discount_value);
    } else if (selectedCoupon.discount_type === 'percentage' && selectedCoupon.discount_value) {
      price = Math.max(0, Math.round(price * (1 - selectedCoupon.discount_value / 100)));
    } else if (selectedCoupon.discount_type === 'special_price' && selectedCoupon.special_price !== null) {
      price = selectedCoupon.special_price;
    }
  }
  if (selectedStaff && (selectedStaff.nomination_fee || 0) > 0) {
    price += selectedStaff.nomination_fee || 0;
  }
  return price;
}

/**
 * "YYYY-MM-DD" 文字列から月/日/曜日を取得する純粋関数（TZ非依存・テスト容易化のため分離）。
 * 【2026年7月8日 恒久根治】旧実装は `new Date(dateStr)` で直接パースしていたが、この形式は
 * ECMAScript仕様でUTC深夜としてパースされ、その後 .getMonth()/.getDate()/.getDay() は実行環境の
 * ローカルタイムゾーンで読まれる。UTCより時刻が遅れるタイムゾーン（UTC+9=JST未満、世界の大半の
 * 地域）で閲覧すると、UTC深夜の直前（前日）に繰り下がり、月/日/曜日の表示が実際に選択した日付
 * から1日ずれる。文字列の年月日をそのまま使い、曜日計算のみ Date.UTC+getUTCDay()
 * （ローカルTZを経由しない）で行うことで基準を固定する。
 */
export function parseDateString(dateStr: string): { month: number; day: number; dayOfWeek: number } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { month, day, dayOfWeek };
}

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 空きスタッフ数から HPB 形式の空き記号を決める純粋関数。
 * - 指名なし（specific=false）: 空きスタッフが多いほど ◎(3+)/○(2)/△(1)、0 は満（×）。
 * - 特定スタッフ指名（specific=true）: そのスタッフが空いていれば ○、いなければ ×。
 * count が undefined（その時間帯にスロット無し）は満扱い。
 */
export function availabilitySymbol(
  count: number | undefined,
  specific: boolean,
): { symbol: '◎' | '○' | '△' | '×'; available: boolean } {
  if (!count || count <= 0) return { symbol: '×', available: false };
  if (specific) return { symbol: '○', available: true };
  if (count >= 3) return { symbol: '◎', available: true };
  if (count === 2) return { symbol: '○', available: true };
  return { symbol: '△', available: true };
}

interface Props {
  facility: { id: string; slug: string; name: string };
  staff: StaffProfile[];
  menus: FacilityMenu[];
  coupons: Coupon[];
  /** 再予約リンク(?menu_id=&staff_id=)からの事前選択。前回と同じメニュー/スタッフを初期選択する。 */
  initialMenuId?: string;
  initialStaffId?: string;
}

const WEEK_SIZE = 7;
/** 時間帯セル1件分の空き情報（count=空きスタッフ数、slot=予約に使う代表スロット）。 */
type Cell = { count: number; slot: AvailableSlot };
/** date -> ("HH:MM" -> Cell) の週マトリクス。 */
type WeekMatrix = Record<string, Record<string, Cell>>;

export default function BookingFlow({ facility, staff, menus, coupons, initialMenuId, initialStaffId }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('menu');
  // メニュー/クーポンのタブ（HPB風にクーポンを主役に置く。クーポンがあれば初期表示をクーポンに）。
  const [menuTab, setMenuTab] = useState<'coupon' | 'menu'>(coupons.length > 0 ? 'coupon' : 'menu');
  // 再予約リンクで渡された ID を menus/staff から解決して初期選択する（該当なしは無選択にフォールバック）。
  // これをしないと「同じ内容で再予約」のクエリが無視され、毎回ゼロから選び直しになる（A-6）。
  const [selectedMenus, setSelectedMenus] = useState<FacilityMenu[]>(
    initialMenuId ? menus.filter((m) => m.id === initialMenuId) : []
  );
  const [selectedStaff, setSelectedStaff] = useState<StaffProfile | null>(
    initialStaffId ? (staff.find((s) => s.id === initialStaffId) ?? null) : null
  );
  const [selectedCoupon, setSelectedCoupon] = useState<Coupon | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [matrix, setMatrix] = useState<WeekMatrix>({});
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 【2026年7月10日 恒久根治】確認ステップの「ログインする」リンクは <a href> によるフルページ
  // 遷移で、選択内容は useState のみで保持されるため React ツリーのアンマウントで全消失していた
  // （数ステップかけた入力が水泡に帰す・離脱率に直結する重大UX欠陥）。ログイン遷移直前に
  // sessionStorage へ保存し、復帰後マウント時に1回だけ読み込んで消去する。
  // スロット選択(selectedSlot)は復元しない：ログイン滞在中に他ユーザーに取られている可能性が
  // あり、鮮度不明な枠をそのまま確認画面に出すと在庫と乖離した表示になるため、日時ステップに
  // 戻して枠を再取得・再選択させる（1クリックのみの負担・在庫整合性を優先）。
  const bookingDraftKey = `booking-draft:${facility.id}`;
  const BOOKING_DRAFT_TTL_MS = 15 * 60 * 1000; // 15分。ログイン離脱後の長時間放置は復元しない。

  function saveBookingDraftBeforeLogin() {
    try {
      sessionStorage.setItem(bookingDraftKey, JSON.stringify({
        savedAt: Date.now(),
        menuIds: selectedMenus.map((m) => m.id),
        staffId: selectedStaff?.id ?? null,
        couponId: selectedCoupon?.id ?? null,
        selectedDate,
        customerName,
        email,
        phone,
        note,
        usePoints,
        pointsToUse,
      }));
    } catch {
      // sessionStorage 不可（プライベートモード等）でも遷移自体は妨げない。
    }
  }

  // Pre-fill from user profile
  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        const meta = user.user_metadata ?? {};
        setCustomerName(
          meta.display_name ||
          meta.full_name ||
          meta.name ||
          ''
        );
        setEmail(user.email || '');
      }
    }).catch(() => {});
  }, []);

  // ログイン遷移からの復帰時、保存済みドラフトを1回だけ復元する（読み取り後は消去）。
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(bookingDraftKey);
      sessionStorage.removeItem(bookingDraftKey);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as {
        savedAt: number;
        menuIds: string[];
        staffId: string | null;
        couponId: string | null;
        selectedDate: string;
        customerName: string;
        email: string;
        phone: string;
        note: string;
        usePoints: boolean;
        pointsToUse: number;
      };
      if (Date.now() - draft.savedAt > BOOKING_DRAFT_TTL_MS) return;

      const restoredMenus = draft.menuIds
        .map((id) => menus.find((m) => m.id === id))
        .filter((m): m is FacilityMenu => !!m);
      if (restoredMenus.length === 0) return; // メニューが復元できなければ復元しない（不整合な部分復元を避ける）

      setSelectedMenus(restoredMenus);
      setSelectedStaff(draft.staffId ? (staff.find((s) => s.id === draft.staffId) ?? null) : null);
      setSelectedCoupon(draft.couponId ? (coupons.find((c) => c.id === draft.couponId) ?? null) : null);
      if (draft.selectedDate) setSelectedDate(draft.selectedDate);
      if (draft.customerName) setCustomerName(draft.customerName);
      if (draft.email) setEmail(draft.email);
      if (draft.phone) setPhone(draft.phone);
      if (draft.note) setNote(draft.note);
      setUsePoints(draft.usePoints);
      setPointsToUse(draft.pointsToUse);
      // 日時ステップへ（枠は在庫鮮度のため再取得・再選択させる）。
      setStep(draft.selectedDate ? 'datetime' : 'menu');
    } catch {
      // 破損データは無視して通常フローを続行。
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalDuration = selectedMenus.reduce((sum, m) => sum + (m.duration_minutes || 60), 0);

  // Generate date options (next 60 days)
  // 【2026年7月8日 恒久根治】旧実装はブラウザのローカル時計(new Date())を基準に日付を生成して
  // いたが、サーバー側の検証(src/lib/validations-booking.ts の getTodayString/getMaxDateString)
  // はJST(UTC+9)固定で「今日」を計算する。JST以外のタイムゾーンで閲覧するユーザー（海外在住・
  // 海外出張中・PCの時計設定がUTC等）では、クライアントが選択可能として提示した日付の一部が
  // サーバー側の「過去の日付は指定できません」バリデーションで拒否されたり、選択した日付が
  // 1日ずれる可能性があった。サーバーと同一のJSTシフトロジックで日付を生成し基準を一致させる。
  const dateOptions = useMemo(() => Array.from({ length: 60 }, (_, i) => {
    const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    jstNow.setUTCDate(jstNow.getUTCDate() + i + 1);
    const year = jstNow.getUTCFullYear();
    const month = String(jstNow.getUTCMonth() + 1).padStart(2, '0');
    const day = String(jstNow.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }), []);

  const maxWeekOffset = Math.max(0, Math.ceil(dateOptions.length / WEEK_SIZE) - 1);
  const visibleDates = useMemo(
    () => dateOptions.slice(weekOffset * WEEK_SIZE, weekOffset * WEEK_SIZE + WEEK_SIZE),
    [dateOptions, weekOffset],
  );
  const visibleKey = visibleDates.join(',');

  // 週×時間の空き状況（◎○△×）を組み立てる。表示中の7日について /api/slots を並列取得し、
  // 各時間帯に「空いているスタッフ数」を数える（指名なしは全スタッフ、指名時は当該1名）。
  // 旧実装の「日付を1つ選ぶ→その日の時間ボタン一覧」を、HPB形式の週マトリクスに置き換える。
  useEffect(() => {
    if (step !== 'datetime') return;
    if (selectedMenus.length === 0) return;
    if (selectedStaff === null && staff.length === 0) return;
    const controller = new AbortController();
    setMatrixLoading(true);

    const targetStaff = selectedStaff ? [selectedStaff] : staff;
    Promise.all(visibleDates.map(async (date) => {
      const perTime = new Map<string, Cell>();
      await Promise.all(targetStaff.map(async (s) => {
        try {
          const r = await fetch(
            `/api/slots?facilityId=${facility.id}&staffId=${s.id}&date=${date}&duration=${totalDuration}`,
            { signal: controller.signal },
          );
          if (!r.ok) return;
          const data = await r.json();
          (data.slots ?? []).forEach((slot: AvailableSlot) => {
            const t = slot.slot_start.slice(0, 5);
            const existing = perTime.get(t);
            if (existing) {
              existing.count += 1;
            } else {
              // 最初に見つかったスタッフのスロットを代表として保持（staff_id付き）。
              perTime.set(t, { count: 1, slot: { ...slot, staff_id: s.id } });
            }
          });
        } catch {
          // 個別スタッフ/日付の失敗は握らず、その分を空きなし扱いにして週全体は表示する。
        }
      }));
      return [date, Object.fromEntries(perTime)] as [string, Record<string, Cell>];
    }))
      .then((entries) => {
        if (controller.signal.aborted) return;
        setMatrix(Object.fromEntries(entries));
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setToast({ type: 'error', message: '空き状況の取得に失敗しました' });
      })
      .finally(() => {
        if (!controller.signal.aborted) setMatrixLoading(false);
      });

    return () => controller.abort();
    // visibleKey で表示週を、selectedStaff で指名を、totalDuration でメニュー変更を検知する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, visibleKey, selectedStaff, totalDuration, facility.id]);

  // マトリクスの行（時間帯）＝表示週で1度でも空きがあった開始時刻の和集合（昇順）。
  const rowTimes = useMemo(() => {
    const set = new Set<string>();
    Object.values(matrix).forEach((day) => Object.keys(day).forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [matrix]);

  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [availablePoints, setAvailablePoints] = useState(0);
  const [usePoints, setUsePoints] = useState(false);
  const [pointsToUse, setPointsToUse] = useState(0);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsAuthenticated(!!user);
      if (user) {
        supabase.from('user_points').select('points').eq('user_id', user.id).then(({ data }) => {
          const total = (data ?? []).reduce((sum: number, r: { points: number }) => sum + r.points, 0);
          setAvailablePoints(Math.max(0, total));
        });
      }
    }).catch(() => setIsAuthenticated(false));
  }, []);

  // Warn on unsaved changes
  useEffect(() => {
    if (step === 'menu') return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [step]);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!customerName || !email) {
      setToast({ type: 'error', message: 'お名前とメールアドレスは必須です' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setToast({ type: 'error', message: '正しいメールアドレスを入力してください' });
      return;
    }
    setSubmitting(true);

    try {
      const res = await fetch('/api/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facility_id: facility.id,
          staff_id: selectedStaff?.id ?? null,
          menu_id: selectedMenus[0]?.id ?? null,
          menu_ids: selectedMenus.map((m) => m.id),
          coupon_id: selectedCoupon?.id ?? null,
          booking_date: selectedDate,
          // API 契約（bookingSchema の timeString）は "HH:MM" 形式必須。空き枠の slot_start/end は
          // get_available_slots が TIME で返すため "HH:MM:SS" になり得る。表示は slice 済みだが
          // 送信は raw だったため、"HH:MM:SS" で届く環境では予約が 400 で必ず失敗していた。
          // 送信時も "HH:MM" に正規化し、slot の時刻フォーマットに依存せず予約を成立させる。
          start_time: selectedSlot?.slot_start?.slice(0, 5),
          end_time: selectedSlot?.slot_end?.slice(0, 5),
          customer_name: customerName,
          email,
          phone: phone || null,
          note: note || null,
          total_price: calculatePrice(),
          points_used: usePoints && pointsToUse > 0 ? pointsToUse : undefined,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const body = await res.json().catch(() => null);
        const completeParams = new URLSearchParams({
          id: body?.bookingId || '',
          date: selectedDate || '',
          // 完了画面の TIME_RE は "HH:MM" 必須。slot は "HH:MM:SS" になり得るため slice して渡す
          // （raw だと .ics「カレンダーに追加」ボタンが無音で出なくなる）。
          time: selectedSlot?.slot_start?.slice(0, 5) || '',
          end_time: selectedSlot?.slot_end?.slice(0, 5) || '',
          facility: facility.name || '',
        });
        router.push(`/facility/${encodeURIComponent(facility.slug)}/booking/complete?${completeParams.toString()}`);
      } else {
        const body = await res.json().catch(() => null);
        setToast({ type: 'error', message: body?.error || '予約に失敗しました' });
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました。もう一度お試しください。' });
    } finally {
      setSubmitting(false);
    }
  };

  const calculatePrice = () => calculateBookingPrice(selectedMenus, selectedCoupon, selectedStaff);

  // メニュー/クーポン変更で価格が下がった場合に、設定済み pointsToUse を価格・残高でクランプし直す。
  // これを怠ると「お支払い金額」が負表示になり、価格を超える points_used を送ってしまう（サーバ側でも
  // クランプするが、表示の不整合と過剰送信を入口で防ぐ）。増加方向には触れない（手動利用を妨げない）。
  useEffect(() => {
    const price = calculatePrice();
    const cap = Math.max(0, Math.min(availablePoints, price ?? 0));
    setPointsToUse((prev) => Math.min(prev, cap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMenus, selectedCoupon, selectedStaff, availablePoints]);

  // 指名スタッフ（フィルタ）を切り替えたら、選択済みの日時をクリアする。指名なしで選んだ枠が
  // 特定スタッフでは空いていないことがあり、鮮度不明な選択を確認画面へ持ち越さないため。
  function changeStaffFilter(next: StaffProfile | null) {
    setSelectedStaff(next);
    setSelectedDate('');
    setSelectedSlot(null);
  }

  const menuTotal = selectedMenus.reduce((s, m) => s + (m.price || 0), 0);

  const steps: { key: Step; label: string }[] = [
    { key: 'menu', label: 'メニュー・クーポン' },
    { key: 'datetime', label: '日時' },
    { key: 'confirm', label: '確認・予約' },
  ];
  const currentIndex = steps.findIndex((s) => s.key === step);
  const specificStaff = selectedStaff !== null;

  return (
    <div>
      {/* Progress */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              i <= currentIndex ? 'bg-primary text-white' : 'bg-gray-200 text-gray-400'
            }`}>
              {i + 1}
            </div>
            <span className={`text-xs whitespace-nowrap ${i <= currentIndex ? 'text-primary font-bold' : 'text-gray-400'}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="w-6 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      {/* Step 1: Menu + Coupon (HPB風タブ) */}
      {step === 'menu' && (
        <div className="space-y-4">
          {/* タブ切替（クーポン主役） */}
          <div className="flex rounded-xl bg-gray-100 p-1 text-sm font-bold">
            <button
              type="button"
              onClick={() => setMenuTab('coupon')}
              className={`flex-1 py-2 rounded-lg transition-colors ${
                menuTab === 'coupon' ? 'bg-white text-primary shadow-sm' : 'text-gray-500'
              }`}
            >
              クーポン{coupons.length > 0 && <span className="ml-1 text-xs">({coupons.length})</span>}
            </button>
            <button
              type="button"
              onClick={() => setMenuTab('menu')}
              className={`flex-1 py-2 rounded-lg transition-colors ${
                menuTab === 'menu' ? 'bg-white text-primary shadow-sm' : 'text-gray-500'
              }`}
            >
              メニューから選ぶ
            </button>
          </div>

          {/* クーポンパネル */}
          {menuTab === 'coupon' && (
            <div className="space-y-2">
              {coupons.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                  <p className="text-gray-400 text-sm">現在利用できるクーポンはありません</p>
                  <button type="button" onClick={() => setMenuTab('menu')} className="text-primary text-sm font-bold mt-2 hover:underline">
                    メニューから選ぶ →
                  </button>
                </div>
              ) : (
                <>
                  {coupons.map((coupon) => {
                    const isSelected = selectedCoupon?.id === coupon.id;
                    const label =
                      coupon.discount_type === 'percentage' && coupon.discount_value
                        ? `${coupon.discount_value}% OFF`
                        : coupon.discount_type === 'fixed' && coupon.discount_value
                        ? `¥${coupon.discount_value.toLocaleString()} OFF`
                        : coupon.discount_type === 'special_price' && coupon.special_price !== null
                        ? `¥${coupon.special_price.toLocaleString()}`
                        : null;
                    return (
                      <button
                        type="button"
                        key={coupon.id}
                        onClick={() => setSelectedCoupon(isSelected ? null : coupon)}
                        className={`w-full text-left rounded-xl border transition-colors overflow-hidden ${
                          isSelected ? 'border-primary ring-2 ring-sky-200' : 'border-gray-200 hover:border-sky-300'
                        }`}
                      >
                        <div className="flex">
                          <div className={`w-1.5 shrink-0 ${isSelected ? 'bg-primary' : 'bg-red-400'}`} />
                          <div className="p-4 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-bold text-sm">{coupon.name}</p>
                              {label && (
                                <span className="shrink-0 text-xs font-bold text-red-500 bg-red-50 rounded-full px-2 py-0.5">
                                  {label}
                                </span>
                              )}
                            </div>
                            {coupon.description && <p className="text-xs text-gray-500 mt-1">{coupon.description}</p>}
                            {isSelected && (
                              <p className="text-xs text-primary font-bold mt-2">✓ 選択中</p>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  <p className="text-xs text-gray-400 pt-1">
                    ※ クーポン適用には対象メニューの選択が必要です。「メニューから選ぶ」で施術内容をお選びください。
                  </p>
                </>
              )}
            </div>
          )}

          {/* メニューパネル */}
          {menuTab === 'menu' && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">施術メニューを選択（複数選択可）</p>
              {menus.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                  <p className="text-gray-400">メニューが登録されていません</p>
                  <p className="text-xs text-gray-400 mt-2">施設にお問い合わせください</p>
                </div>
              )}
              {menus.map((menu) => {
                const isSelected = selectedMenus.some((m) => m.id === menu.id);
                return (
                  <button
                    type="button"
                    key={menu.id}
                    onClick={() => {
                      setSelectedMenus((prev) =>
                        isSelected ? prev.filter((m) => m.id !== menu.id) : [...prev, menu]
                      );
                    }}
                    className={`w-full text-left p-4 rounded-xl border transition-colors ${
                      isSelected ? 'border-primary bg-sky-50' : 'border-gray-200 hover:border-sky-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${isSelected ? 'border-primary bg-primary' : 'border-gray-300'}`}>
                        {isSelected && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-sm">{menu.name}</p>
                        {menu.description && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{menu.description}</p>}
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          {menu.price !== null && <span className="text-red-500 font-bold">¥{menu.price.toLocaleString()}</span>}
                          {menu.duration_minutes && <span>{menu.duration_minutes}分</span>}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* 選択サマリ + 次へ */}
          <div className="pt-2 border-t space-y-2">
            {selectedCoupon && (
              <div className="text-sm flex items-center justify-between">
                <span className="text-gray-500">クーポン</span>
                <span className="font-bold text-red-500">{selectedCoupon.name}</span>
              </div>
            )}
            <div className="text-sm text-gray-600 flex flex-wrap items-center gap-x-3">
              {selectedMenus.length > 0 ? (
                <>
                  <span className="font-bold">{selectedMenus.length}件選択中</span>
                  <span>合計 ¥{menuTotal.toLocaleString()}</span>
                  <span>{selectedMenus.reduce((s, m) => s + (m.duration_minutes || 60), 0)}分</span>
                </>
              ) : (
                <span className="text-gray-400">メニューを1つ以上選択してください</span>
              )}
            </div>
            <button
              type="button"
              disabled={selectedMenus.length === 0}
              onClick={() => setStep('datetime')}
              className="btn-primary w-full !py-3 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              次へ（日時を選ぶ）
            </button>
          </div>
        </div>
      )}

      {/* Step 2: DateTime — HPB風の週×時間 空き状況カレンダー */}
      {step === 'datetime' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-bold">日時を選択</h2>
            {/* 空き記号の凡例 */}
            <div className="flex items-center gap-2 text-micro text-gray-400">
              <span>◎ 空き十分</span><span>○ 空きあり</span><span>△ 残少</span><span>× 満</span>
            </div>
          </div>

          {/* スタッフ指名フィルタ（HPBはカレンダー上でスタイリストを絞り込む） */}
          {staff.length > 0 && (
            <div>
              <label htmlFor="staff-filter" className="text-xs text-gray-500">スタッフ指名</label>
              <select
                id="staff-filter"
                value={selectedStaff?.id ?? ''}
                onChange={(e) => {
                  const s = staff.find((x) => x.id === e.target.value) ?? null;
                  changeStaffFilter(s);
                }}
                className="form-input mt-1"
              >
                <option value="">指名なし（おまかせ）</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.nomination_fee > 0 ? `（指名料 ¥${s.nomination_fee.toLocaleString()}）` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 週送り */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              disabled={weekOffset === 0}
              onClick={() => setWeekOffset((w) => Math.max(0, w - 1))}
              className="text-sm text-primary font-bold disabled:text-gray-300 disabled:cursor-not-allowed px-2 py-1"
            >
              ‹ 前の7日
            </button>
            <span className="text-xs text-gray-500">
              {visibleDates.length > 0 && (() => {
                const a = parseDateString(visibleDates[0]);
                const b = parseDateString(visibleDates[visibleDates.length - 1]);
                return `${a.month}/${a.day} 〜 ${b.month}/${b.day}`;
              })()}
            </span>
            <button
              type="button"
              disabled={weekOffset >= maxWeekOffset}
              onClick={() => setWeekOffset((w) => Math.min(maxWeekOffset, w + 1))}
              className="text-sm text-primary font-bold disabled:text-gray-300 disabled:cursor-not-allowed px-2 py-1"
            >
              次の7日 ›
            </button>
          </div>

          {/* 空き状況マトリクス */}
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full border-collapse text-center select-none">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-gray-50 z-10 w-12" />
                  {visibleDates.map((date) => {
                    const { month, day, dayOfWeek } = parseDateString(date);
                    const isSun = dayOfWeek === 0;
                    const isSat = dayOfWeek === 6;
                    return (
                      <th key={date} className="py-1 px-0.5 min-w-[40px]">
                        <div className="text-micro text-gray-400">{month}/{day}</div>
                        <div className={`text-xs font-bold ${isSun ? 'text-red-500' : isSat ? 'text-sky-500' : 'text-gray-600'}`}>
                          {DAY_NAMES[dayOfWeek]}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {matrixLoading ? (
                  <tr>
                    <td colSpan={visibleDates.length + 1} className="py-10">
                      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                    </td>
                  </tr>
                ) : rowTimes.length === 0 ? (
                  <tr>
                    <td colSpan={visibleDates.length + 1} className="py-10 text-sm text-gray-400">
                      この期間は予約可能な時間帯がありません。別の週をお選びください。
                    </td>
                  </tr>
                ) : (
                  rowTimes.map((time) => (
                    <tr key={time} className="border-t border-gray-100">
                      <td className="sticky left-0 bg-white z-10 text-xs font-bold text-gray-500 py-1 pr-1 whitespace-nowrap">
                        {time}
                      </td>
                      {visibleDates.map((date) => {
                        const cell = matrix[date]?.[time];
                        const { symbol, available } = availabilitySymbol(cell?.count, specificStaff);
                        const isActive = selectedDate === date && selectedSlot?.slot_start?.slice(0, 5) === time;
                        const d = parseDateString(date);
                        return (
                          <td key={date} className="p-0.5">
                            <button
                              type="button"
                              disabled={!available}
                              aria-label={`${d.month}/${d.day} ${time} ${available ? '予約可' : '満席'}`}
                              onClick={() => {
                                if (!cell) return;
                                setSelectedDate(date);
                                setSelectedSlot(cell.slot);
                              }}
                              className={`w-full min-h-[40px] rounded-md text-base font-bold transition-colors ${
                                !available
                                  ? 'text-gray-300 cursor-not-allowed'
                                  : isActive
                                  ? 'bg-primary text-white'
                                  : 'text-primary hover:bg-sky-50'
                              }`}
                            >
                              {symbol}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 選択中の日時 + 次へ */}
          {selectedSlot && selectedDate && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-sm">
              <span className="text-gray-500">選択中：</span>
              <span className="font-bold ml-1">
                {(() => { const d = parseDateString(selectedDate); return `${d.month}/${d.day}（${DAY_NAMES[d.dayOfWeek]}）`; })()}
                {' '}{selectedSlot.slot_start.slice(0, 5)}〜{selectedSlot.slot_end.slice(0, 5)}
              </span>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setStep('menu')} className="text-sm text-gray-500 hover:underline px-2">
              戻る
            </button>
            {selectedSlot && (
              <button type="button" onClick={() => setStep('confirm')} className="btn-primary flex-1 !py-3">
                次へ（確認・予約）
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Confirm (info + summary + submit) */}
      {step === 'confirm' && (
        <div className="space-y-4">
          <h2 className="font-bold">予約内容の確認・お客様情報</h2>

          {/* Summary card */}
          <div className="bg-sky-50 rounded-xl border border-sky-200 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">施設</span>
              <span className="font-medium">{facility.name}</span>
            </div>
            {selectedMenus.map((m) => (
              <div key={m.id} className="flex justify-between">
                <span className="text-gray-500 ml-2">{m.name}</span>
                <span className="text-gray-500">{m.price !== null ? `¥${m.price.toLocaleString()}` : ''}</span>
              </div>
            ))}
            <div className="flex justify-between">
              <span className="text-gray-500">スタッフ</span>
              <span className="font-medium">
                {selectedStaff ? (
                  <>
                    {selectedStaff.name}
                    {selectedStaff.nomination_fee > 0 && <span className="text-xs text-gray-400 ml-1">(+¥{selectedStaff.nomination_fee.toLocaleString()})</span>}
                  </>
                ) : '指名なし（おまかせ）'}
              </span>
            </div>
            {selectedCoupon && (
              <div className="flex justify-between">
                <span className="text-gray-500">クーポン</span>
                <span className="font-medium text-red-500">{selectedCoupon.name}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">日時</span>
              <span className="font-medium">
                {(() => { const d = parseDateString(selectedDate); return `${d.month}/${d.day}（${DAY_NAMES[d.dayOfWeek]}）`; })()}
                {' '}{selectedSlot?.slot_start.slice(0, 5)}〜{selectedSlot?.slot_end.slice(0, 5)}
              </span>
            </div>
            {(() => {
              const finalPrice = calculatePrice();
              if (finalPrice === null) return null;
              const hasCouponDiscount = selectedCoupon && menuTotal > finalPrice;
              return (
                <div className="border-t border-sky-200 pt-2 mt-2 space-y-1">
                  {hasCouponDiscount && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">通常合計</span>
                      <span className="text-gray-400 line-through">¥{menuTotal.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="font-bold">{hasCouponDiscount ? 'クーポン適用後' : '合計金額'}</span>
                    <span className="font-bold text-lg text-red-500">¥{finalPrice.toLocaleString()}</span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Customer info form（例示はラベルに統合＝入力ヒント） */}
          <div className="space-y-3">
            <h3 className="font-bold text-sm">お客様情報</h3>
            <div>
              <label htmlFor="booking-name" className="form-label">
                お名前 <span className="text-red-500">*</span>
                <span className="text-gray-400 font-normal text-xs ml-2">例：山田 太郎</span>
              </label>
              <input
                id="booking-name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="form-input"
                aria-required="true"
                maxLength={50}
              />
            </div>
            <div>
              <label htmlFor="booking-email" className="form-label">
                メールアドレス <span className="text-red-500">*</span>
                <span className="text-gray-400 font-normal text-xs ml-2">例：example@email.com</span>
              </label>
              <input
                id="booking-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                className="form-input"
                aria-required="true"
                maxLength={254}
              />
            </div>
            <div>
              <label htmlFor="booking-phone" className="form-label">
                電話番号
                <span className="text-gray-400 font-normal text-xs ml-2">例：090-1234-5678</span>
              </label>
              <input
                id="booking-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel"
                className="form-input"
                maxLength={20}
              />
            </div>
            <div>
              <label htmlFor="booking-note" className="form-label">ご要望・備考</label>
              <textarea
                id="booking-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="form-input"
                rows={3}
                maxLength={500}
              />
              <p className="text-xs text-gray-400 mt-1">ご要望があればご記入ください</p>
            </div>
          </div>

          {/* Points */}
          {(() => {
            const currentPrice = calculatePrice();
            if (!isAuthenticated || availablePoints <= 0 || currentPrice === null) return null;
            return (
              <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={usePoints} onChange={(e) => { setUsePoints(e.target.checked); if (!e.target.checked) setPointsToUse(0); }} />
                  <span>ポイントを使う（{availablePoints.toLocaleString()}pt 利用可能）</span>
                </label>
                {usePoints && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={Math.min(availablePoints, currentPrice)}
                      value={pointsToUse}
                      onChange={(e) => setPointsToUse(Math.min(Number(e.target.value) || 0, availablePoints, currentPrice))}
                      className="form-input !w-28 text-sm"
                    />
                    <span className="text-xs text-gray-500">pt（1pt=1円）</span>
                    <button type="button" onClick={() => setPointsToUse(Math.min(availablePoints, currentPrice))} className="text-xs text-primary hover:underline">全額使用</button>
                  </div>
                )}
                {usePoints && pointsToUse > 0 && (
                  <p className="text-sm font-bold">お支払い金額: ¥{(currentPrice - pointsToUse).toLocaleString()}</p>
                )}
              </div>
            );
          })()}

          {isAuthenticated === false && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">
              <p className="font-bold">ログインしていません</p>
              <p className="text-xs mt-1">ログインせずに予約すると、予約履歴から確認・キャンセルできません。</p>
              <a
                href={`/auth/login?redirect=/facility/${facility.slug}/booking`}
                onClick={saveBookingDraftBeforeLogin}
                className="text-xs text-primary hover:underline mt-1 inline-block"
              >
                ログインする
              </a>
            </div>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={() => setStep('datetime')} className="text-sm text-gray-500 hover:underline px-2">
              戻る
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="btn-primary flex-1 !py-3"
            >
              {submitting ? '予約中...' : 'この内容で予約する'}
            </button>
          </div>
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
