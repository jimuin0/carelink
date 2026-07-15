'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import type { StaffProfile, FacilityMenu, Coupon, AvailableSlot } from '@/types';
import { describeCancelPolicy, type CancelPolicy } from '@/lib/cancel-fee';
import { calculateCouponDiscountedTotal } from '@/lib/coupon-pricing';

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
 *
 * 【2026年7月15日 HPB準拠仕様】クーポン割引計算そのものは calculateCouponDiscountedTotal
 * （src/lib/coupon-pricing.ts）に一本化した。クライアント表示額とサーバー(/api/booking)の
 * 請求額が別実装でドリフトする事故を構造的に防ぐ（サーバーが権威）。allowedMenuIds は
 * couponMenuMap[selectedCoupon.id]（coupon_menus に行があるクーポンのみキーを持つ）を渡す。
 */
export function calculateBookingPrice(
  selectedMenus: FacilityMenu[],
  selectedCoupon: Coupon | null,
  selectedStaff: StaffProfile | null,
  allowedMenuIds?: string[],
): number | null {
  if (selectedMenus.length === 0) return null;
  let price = calculateCouponDiscountedTotal(selectedMenus, selectedCoupon, allowedMenuIds);
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

/**
 * クーポンの対象メニュー制約(coupon_menus)と選択中メニューの適合を判定する純粋関数。
 * 【2026年7月15日 恒久予防】サーバー(src/app/api/booking/route.ts)のクーポン×メニュー適合
 * チェックと同一の意味論＝coupon_menusに行がある(allowedMenuIdsが空でない)クーポンは対象メニュー
 * 限定・行が無い(allowedMenuIdsが未定義/空)クーポンは全メニュー適用。
 * selectedMenuIds が空（メニュー未選択）は「まだ不適合と決め付けない」ため適合扱いにする
 * （クーポンを先に選ぶ導線＝menuTab初期表示がクーポン、を妨げないため）。
 */
export function isCouponMenuCompatible(
  allowedMenuIds: string[] | undefined,
  selectedMenuIds: string[],
): boolean {
  if (!allowedMenuIds || allowedMenuIds.length === 0) return true;
  if (selectedMenuIds.length === 0) return true;
  return selectedMenuIds.some((id) => allowedMenuIds.includes(id));
}

interface Props {
  facility: { id: string; slug: string; name: string };
  staff: StaffProfile[];
  menus: FacilityMenu[];
  coupons: Coupon[];
  /** 再予約リンク(?menu_id=&staff_id=)からの事前選択。前回と同じメニュー/スタッフを初期選択する。 */
  initialMenuId?: string;
  initialStaffId?: string;
  /** 施設のキャンセルポリシー（未設定施設は null。確認画面にグレースフルに非表示になる）。 */
  cancelPolicy?: CancelPolicy | null;
  /**
   * クーポンID → 対象メニューID配列（coupon_menusに行があるクーポンのみキーを持つ）。
   * 【2026年7月15日 恒久予防】サーバー(src/app/api/booking/route.ts)のクーポン×メニュー適合
   * チェックと同一の意味論をクライアントでも先回りして案内する（サーバーはfail-closedの最終防波堤・
   * こちらはUX上の事前ガード）。キーが無いクーポンは全メニュー適用（本番の現状デフォルト）。
   */
  couponMenuMap?: Record<string, string[]>;
}

const WEEK_SIZE = 7;
/** 時間帯セル1件分の空き情報（count=空きスタッフ数、slot=予約に使う代表スロット）。 */
type Cell = { count: number; slot: AvailableSlot };
/** date -> ("HH:MM" -> Cell) の週マトリクス。 */
type WeekMatrix = Record<string, Record<string, Cell>>;
/** 1スタッフ分の /api/slots 取得結果。取得失敗（非ok・例外）時は null。 */
export type StaffSlotsResult = { staffId: string; slots: AvailableSlot[] } | null;

/**
 * 1日分の「スタッフ別 空きスロット取得結果」を、時間帯("HH:MM") -> Cell のマップへ決定的に
 * マージする純粋関数（TZ非依存の日付計算等と同様、テスト容易化・回帰防止のため分離）。
 * 【2026年7月15日 恒久根治】旧実装は各スタッフの fetch 完了時にその場で直接マージしていたため、
 * 同一時間帯に複数スタッフの空きがある場合の「代表スロット」（おまかせ＝指名なし時に予約確定へ
 * 進む対象スタッフ）が、ネットワークの揺らぎによる fetch 完了順という非決定的な要因で決まって
 * いた。results は呼び出し側で Promise.all(targetStaff.map(...)) の戻り値をそのまま渡す前提
 * （Promise.all は完了順ではなく入力配列の順序を保証する）。ここで配列の先頭から順に処理する
 * ことで、常に staff 配列順（サーバーの sort_order）で決定的に代表スタッフが選ばれる。
 */
export function mergeStaffSlotsForDate(results: StaffSlotsResult[]): Record<string, Cell> {
  const perTime = new Map<string, Cell>();
  results.forEach((result) => {
    if (!result) return;
    result.slots.forEach((slot) => {
      const t = slot.slot_start.slice(0, 5);
      const existing = perTime.get(t);
      if (existing) {
        existing.count += 1;
      } else {
        perTime.set(t, { count: 1, slot: { ...slot, staff_id: result.staffId } });
      }
    });
  });
  return Object.fromEntries(perTime);
}

export default function BookingFlow({ facility, staff, menus, coupons, initialMenuId, initialStaffId, cancelPolicy, couponMenuMap = {} }: Props) {
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
  // 「（自動選択済み）」表示・自動選択トーストを【実際に自動追加が発生した時のみ】出すための
  // 状態（どのクーポンの自動追加が発生したか）。詳細は handleCouponSelect のコメント参照。
  const [autoSelectedCouponId, setAutoSelectedCouponId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [matrix, setMatrix] = useState<WeekMatrix>({});
  const [matrixLoading, setMatrixLoading] = useState(false);
  // 【2026年7月15日 恒久根治】/api/slots の失敗（非ok・例外）を「空きなし」に偽装せず、
  // 満席表示と明確に区別されたエラーUIを出すためのフラグ。1件でも失敗があれば true にする
  // （AbortError＝effect クリーンアップによる意図的な中断は失敗として扱わない）。
  const [matrixError, setMatrixError] = useState(false);
  // 再試行ボタンから effect を強制再実行させるためのカウンタ（依存配列に含める）。
  const [matrixRetryTick, setMatrixRetryTick] = useState(0);
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

  // Generate date options (today + next 59 days = 60 days)
  // 【2026年7月8日 恒久根治】旧実装はブラウザのローカル時計(new Date())を基準に日付を生成して
  // いたが、サーバー側の検証(src/lib/validations-booking.ts の getTodayString/getMaxDateString)
  // はJST(UTC+9)固定で「今日」を計算する。JST以外のタイムゾーンで閲覧するユーザー（海外在住・
  // 海外出張中・PCの時計設定がUTC等）では、クライアントが選択可能として提示した日付の一部が
  // サーバー側の「過去の日付は指定できません」バリデーションで拒否されたり、選択した日付が
  // 1日ずれる可能性があった。サーバーと同一のJSTシフトロジックで日付を生成し基準を一致させる。
  // 【2026年7月15日 恒久根治】旧実装は `i + 1` で常に翌日始まりだった。サーバー側
  // (validations-booking.ts の getTodayString、/api/slots の AV-3 過去時刻除外)は当日予約を
  // 許可しているのに、UI側だけが当日をカレンダーから除外し到達不能にしていた（HPB等の実サービスは
  // 当日予約を前面に出す）。`i`（当日始まり）に変更し、当日は過去時刻分のみ /api/slots が
  // 自動的に除外するため UI 側で別途過去時刻フィルタは不要。
  const dateOptions = useMemo(() => Array.from({ length: 60 }, (_, i) => {
    const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    jstNow.setUTCDate(jstNow.getUTCDate() + i);
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
  //
  // 【2026年7月15日 恒久根治・defect1】/api/slots の失敗（!r.ok・例外）を握り潰して「空きなし」と
  // 同一視していたが、/api/slots 側（route.ts）は「取得失敗を空き枠なしに偽装しない」設計思想
  // （RPCエラーは500で返し、Sentry+Slackで顕在化させる）。クライアントがそれを再び握り潰すと、
  // 障害発生時に顧客には単なる「満席」に見えてしまう（実際は復旧すれば予約できるはずの枠が見えない）。
  // 1件でも失敗（非ok・AbortError以外の例外）があれば matrixError を立て、満席とは明確に区別した
  // エラーUI＋再試行ボタンを出す。AbortError（effect クリーンアップによる意図的中断）は失敗として
  // 扱わない。
  //
  // 【2026年7月15日 恒久根治・defect8】旧実装は各スタッフの fetch を並列実行しつつ、完了した順に
  // その場で perTime へ書き込んでいたため、同じ時間帯に複数スタッフの空きがある場合の「代表スロット」
  // が fetch 完了タイミング（ネットワークの揺らぎ）に左右される非決定的な選出になっていた
  // （= 表示のたびに代表スタッフが変わりうる）。fetch 自体は並列実行して速度を維持しつつ、
  // 結果のマージは Promise.all が返す配列（= targetStaff の入力順と同じ順序で並ぶ。Promise.all は
  // 完了順ではなく入力順を保証する）を使って行うことで、常に staff 配列順（サーバーの sort_order）
  // で決定的に代表スタッフを選ぶ。
  useEffect(() => {
    if (step !== 'datetime') return;
    if (selectedMenus.length === 0) return;
    if (selectedStaff === null && staff.length === 0) return;
    const controller = new AbortController();
    setMatrixLoading(true);
    setMatrixError(false);

    const targetStaff = selectedStaff ? [selectedStaff] : staff;
    let hadFailure = false;

    Promise.all(visibleDates.map(async (date) => {
      const results = await Promise.all(targetStaff.map(async (s) => {
        try {
          const r = await fetch(
            `/api/slots?facilityId=${facility.id}&staffId=${s.id}&date=${date}&duration=${totalDuration}`,
            { signal: controller.signal },
          );
          if (!r.ok) {
            hadFailure = true;
            return null;
          }
          const data = await r.json();
          return { staffId: s.id, slots: (data.slots ?? []) as AvailableSlot[] };
        } catch (err) {
          if ((err as { name?: string })?.name !== 'AbortError') hadFailure = true;
          return null;
        }
      }));

      // targetStaff と同じ順序（= staff 配列順）でマージする。これにより代表スロットの選出は
      // fetch の完了タイミングに依存せず、常に同じスタッフが優先される。
      return [date, mergeStaffSlotsForDate(results)] as [string, Record<string, Cell>];
    }))
      .then((entries) => {
        if (controller.signal.aborted) return;
        setMatrix(Object.fromEntries(entries));
        setMatrixError(hadFailure);
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') {
          setMatrixError(true);
          setToast({ type: 'error', message: '空き状況の取得に失敗しました' });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setMatrixLoading(false);
      });

    return () => controller.abort();
    // visibleKey で表示週を、selectedStaff で指名を、totalDuration でメニュー変更を検知する。
    // matrixRetryTick は再試行ボタンから effect を強制再実行させるためだけの依存。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, visibleKey, selectedStaff, totalDuration, facility.id, matrixRetryTick]);

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

  const calculatePrice = () =>
    calculateBookingPrice(selectedMenus, selectedCoupon, selectedStaff, selectedCoupon ? couponMenuMap[selectedCoupon.id] : undefined);

  // 【2026年7月15日 恒久予防】選択中クーポンが対象メニュー限定で、メニュー選択の変更により
  // 選択中メニューがその対象から外れた場合、クーポン選択を自動解除し警告する。サーバー
  // (/api/booking)は同じ適合チェックを fail-closed（無言で割引を適用しない・400）で最終防御
  // するが、ここではその手前でユーザーに気づかせる（黙って高い金額のまま予約されるのを防ぐ）。
  useEffect(() => {
    if (!selectedCoupon) return;
    const allowedMenuIds = couponMenuMap[selectedCoupon.id];
    if (!isCouponMenuCompatible(allowedMenuIds, selectedMenus.map((m) => m.id))) {
      setSelectedCoupon(null);
      setAutoSelectedCouponId(null);
      setToast({ type: 'error', message: '選択したメニューはこのクーポンの対象外のため、クーポンの選択を解除しました' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMenus]);

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

  /**
   * クーポン選択時のハンドラ（HPB準拠のUX＝「クーポン=施術が決まる」）。
   * 【2026年7月15日】coupon_menus に行があるクーポン（対象メニュー限定）を選ぶと、対象メニューを
   * 自動で selectedMenus に追加する（既に選択済みのメニューはそのまま維持＝マージ。対象+対象外
   * 混在の予約を妨げない）。対象未設定クーポン（allowedMenuIds が空/undefined）は従来どおり
   * 手動選択のみで、ここでは selectedMenus に触れない。
   * 「（自動選択済み）」ラベルとトーストは【実際に自動追加が発生した時のみ】出す
   * （対象メニューを既にユーザーが選択済みの場合、追加0件なのに「自動選択済み」と表示するのは
   * 事実と異なるため）。autoSelectedCouponId でどのクーポンの自動追加が発生したかを保持する。
   */
  function handleCouponSelect(coupon: Coupon, allowedMenuIds: string[] | undefined, isSelected: boolean) {
    if (isSelected) {
      setSelectedCoupon(null);
      setAutoSelectedCouponId(null);
      return;
    }
    setSelectedCoupon(coupon);
    setAutoSelectedCouponId(null);
    const isMenuRestricted = !!allowedMenuIds && allowedMenuIds.length > 0;
    if (!isMenuRestricted) return;

    const targetMenus = allowedMenuIds!
      .map((id) => menus.find((m) => m.id === id))
      .filter((m): m is FacilityMenu => !!m);
    if (targetMenus.length === 0) return;

    // クリック時点の選択状態から「実際に追加されるメニュー」を判定する（追加0件なら自動選択の
    // 表示・通知は一切出さない）。state 更新自体は prev ベースのマージで安全に行う。
    const existingIds = new Set(selectedMenus.map((m) => m.id));
    const additions = targetMenus.filter((m) => !existingIds.has(m.id));
    if (additions.length === 0) return;

    setSelectedMenus((prev) => {
      const prevIds = new Set(prev.map((m) => m.id));
      const adds = targetMenus.filter((m) => !prevIds.has(m.id));
      return adds.length > 0 ? [...prev, ...adds] : prev;
    });
    setAutoSelectedCouponId(coupon.id);
    const names = additions.map((m) => m.name).join('、');
    setToast({ type: 'success', message: `「${coupon.name}」の対象メニュー（${names}）を自動選択しました` });
  }

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
                    // 【2026年7月15日 恒久予防】クーポン×メニュー適合制約。coupon_menus に行がある
                    // （＝couponMenuMap にキーを持つ）クーポンは対象メニュー限定。選択中メニューが
                    // 1件以上あり、かつどれも対象に含まれない場合は選択不可にする（サーバーの
                    // fail-closed 400 と同一の意味論をUXで先回りする）。
                    const allowedMenuIds = couponMenuMap[coupon.id];
                    const isMenuRestricted = !!allowedMenuIds && allowedMenuIds.length > 0;
                    const isIncompatible = isMenuRestricted && !isCouponMenuCompatible(allowedMenuIds, selectedMenus.map((m) => m.id));
                    const targetMenuNames = isMenuRestricted
                      ? allowedMenuIds!
                          .map((id) => menus.find((m) => m.id === id)?.name)
                          .filter((n): n is string => !!n)
                      : [];
                    return (
                      <button
                        type="button"
                        key={coupon.id}
                        disabled={isIncompatible}
                        aria-disabled={isIncompatible}
                        onClick={() => { if (isIncompatible) return; handleCouponSelect(coupon, allowedMenuIds, isSelected); }}
                        className={`w-full text-left rounded-xl border transition-colors overflow-hidden ${
                          isIncompatible
                            ? 'border-gray-200 opacity-50 cursor-not-allowed'
                            : isSelected ? 'border-primary ring-2 ring-sky-200' : 'border-gray-200 hover:border-sky-300'
                        }`}
                      >
                        <div className="flex">
                          <div className={`w-1.5 shrink-0 ${isSelected && !isIncompatible ? 'bg-primary' : 'bg-red-400'}`} />
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
                            {isMenuRestricted && targetMenuNames.length > 0 && (
                              <p className={`text-xs mt-1 ${isIncompatible ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                                対象メニュー：{targetMenuNames.join('、')}
                                {isIncompatible && '（選択中のメニューでは利用できません）'}
                                {/* HPB準拠UX：クーポン選択で対象メニューの自動追加が【実際に発生した】
                                    時のみ明示する（既に選択済みで追加0件の場合は表示しない） */}
                                {isSelected && !isIncompatible && autoSelectedCouponId === coupon.id && '（自動選択済み）'}
                              </p>
                            )}
                            {isSelected && !isIncompatible && (
                              <p className="text-xs text-primary font-bold mt-2">✓ 選択中</p>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  <p className="text-xs text-gray-400 pt-1">
                    ※ クーポンには対象メニューが限定されているものがあります。対象外のメニューでは選択できません。「メニューから選ぶ」で施術内容をお選びください。
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
                // HPB準拠UX：選択中クーポンの対象メニュー（自動選択されたメニュー）にバッジを出す。
                // 対象未設定クーポン（allowedMenuIds が空/undefined）の場合は何も表示しない。
                const selectedCouponAllowedIds = selectedCoupon ? couponMenuMap[selectedCoupon.id] : undefined;
                const isCouponTarget = !!selectedCouponAllowedIds && selectedCouponAllowedIds.includes(menu.id);
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
                        <div className="flex items-center gap-1.5">
                          <p className="font-bold text-sm">{menu.name}</p>
                          {isCouponTarget && (
                            <span className="shrink-0 text-[10px] font-bold text-primary bg-sky-50 border border-sky-200 rounded-full px-1.5 py-0.5">
                              クーポン対象
                            </span>
                          )}
                        </div>
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

          {/* 【2026年7月15日 defect5】選択中の内容サマリ（HPBの「選択中の内容」相当）。
              日時選択に集中している間もメニュー・スタッフ・合計金額・所要時間を常時視認できるようにする。 */}
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 text-xs text-gray-600">
            <p className="font-bold text-gray-700 mb-1">選択中の内容</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {selectedCoupon && <span className="text-red-500 font-bold">{selectedCoupon.name}</span>}
              {selectedMenus.map((m) => (
                <span key={m.id}>{m.name}</span>
              ))}
              <span>{totalDuration}分</span>
              <span>{selectedStaff ? `${selectedStaff.name} 指名` : '指名なし（おまかせ）'}</span>
              {(() => {
                const price = calculatePrice();
                return price !== null ? (
                  <span className="font-bold text-gray-800">合計 ¥{price.toLocaleString()}</span>
                ) : null;
              })()}
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

          {/* 【2026年7月15日 defect1】/api/slots の取得失敗（満席とは別の障害）を明確に区別して通知する。
              満席表示（× のみ・「予約可能な時間帯がありません」）に埋もれさせない。 */}
          {matrixError && !matrixLoading && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600 flex items-center justify-between gap-2 flex-wrap" role="alert">
              <span>空き状況を取得できませんでした。通信状況をご確認のうえ再度お試しください。</span>
              <button
                type="button"
                onClick={() => setMatrixRetryTick((t) => t + 1)}
                className="text-red-600 font-bold underline shrink-0"
              >
                再試行
              </button>
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
                    // 【2026年7月15日】当日(dateOptions[0])はHPB同様「本日」で強調し、
                    // 当日予約がカレンダー上で目立つようにする（当日を隠さない・defect2の一環）。
                    const isToday = date === dateOptions[0];
                    return (
                      <th key={date} className="py-1 px-0.5 min-w-[44px]">
                        {isToday && <div className="text-micro font-bold text-primary">本日</div>}
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
                      {/* matrixError 時は「満席」ではなく「取得不可（不明）」であることを明示する
                          （上のエラーバナーで再試行を促すため、ここでは満席と誤読させない文言に限定）。 */}
                      {matrixError
                        ? '空き状況を確認できませんでした。'
                        : 'この期間は予約可能な時間帯がありません。別の週をお選びください。'}
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
                              className={`w-full min-h-[44px] rounded-md text-base font-bold transition-colors ${
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

          {/* 【2026年7月15日 defect4】キャンセルポリシー（施設が設定している場合のみ表示・
              未設定施設ではグレースフルに非表示）。予約確定ボタンの直前に表示する。 */}
          {cancelPolicy && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-gray-600 space-y-1">
              <p className="font-bold text-gray-700">キャンセルポリシー</p>
              <p>{describeCancelPolicy(cancelPolicy)}</p>
              {cancelPolicy.policy_text && (
                <p className="whitespace-pre-wrap">{cancelPolicy.policy_text}</p>
              )}
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
