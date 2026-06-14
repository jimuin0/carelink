'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import { statusGanttClass } from '@/lib/booking-status';
import { timeToMinutes, minutesToTime, snapToSlot, computeEndMinutes, endExceedsClose, assignLanes } from '@/lib/board-time';

export type BoardChip = {
  id: string;
  customer_name: string;
  start_time: string;
  end_time: string;
  status: string;
  menuName: string | null;
};
export type BoardRow = {
  key: string; // staff_id または '__unassigned__'
  name: string;
  position: string | null;
  nominationFee: number; // 指名料（'__unassigned__' は 0）
  chips: BoardChip[];
};
export type StaffOption = { key: string; name: string; nominationFee: number };
export type BoardMenu = {
  id: string;
  name: string;
  price: number | null;
  duration_minutes: number | null;
};

/**
 * サロンボードのスタッフ×時間軸グリッド（クライアント）。
 * 空き帯クリックでスタッフ・開始時刻をプリセットした新規予約モーダルを開く。
 */
export default function BoardScheduleGrid({
  facilityId,
  date,
  openHour,
  closeHour,
  rows,
  menus,
}: {
  facilityId: string;
  date: string;
  openHour: number;
  closeHour: number;
  rows: BoardRow[];
  menus: BoardMenu[];
}) {
  const router = useRouter();
  const totalMin = (closeHour - openHour) * 60;
  const hours = Array.from({ length: closeHour - openHour }, (_, i) => openHour + i);
  // 担当変更(M3)・指名料(M1)用にスタッフ選択肢を行から導出
  const staffOptions: StaffOption[] = rows.map((r) => ({ key: r.key, name: r.name, nominationFee: r.nominationFee }));

  const [modalOpen, setModalOpen] = useState(false);
  const [preset, setPreset] = useState<{ staffKey: string; start: string }>({
    staffKey: '__unassigned__',
    start: minutesToTime(openHour * 60),
  });

  function openModal(row: BoardRow, startMin: number) {
    setPreset({ staffKey: row.key, start: minutesToTime(snapToSlot(startMin)) });
    setModalOpen(true);
  }

  // タッチでのスクロール/ドラッグを「新規予約タップ」と誤認しないためのしきい値判定。
  // pointerdown 位置を記録し、click 時に移動量が DRAG_THRESHOLD_PX を超えていれば無視する
  // （スクロール由来のタップ誤発火を防ぎつつ、デスクトップのクリック位置での時刻指定は維持）。
  const DRAG_THRESHOLD_PX = 10;
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  function handleTrackPointerDown(e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) {
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
  }

  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>, row: BoardRow) {
    // チップ（Link）クリックは詳細遷移に任せる
    if ((e.target as HTMLElement).closest('a')) return;
    // スクロール/ドラッグ（移動量がしきい値超）はタップ扱いしない
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (start) {
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (moved > DRAG_THRESHOLD_PX) return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    openModal(row, openHour * 60 + ratio * totalMin);
  }

  // キーボード操作: Enter/Space で営業開始時刻を初期値にモーダルを開く（時刻はモーダル内で調整）
  function handleTrackKeyDown(e: React.KeyboardEvent<HTMLDivElement>, row: BoardRow) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openModal(row, openHour * 60);
    }
  }

  return (
    <>
      {rows.map((row) => {
        const openMin = openHour * 60;
        const closeMin = closeHour * 60;
        // 営業時間帯に重なるチップ（部分はみ出しは端にクランプして表示）と、完全に枠外のチップを分離
        const inWindow = row.chips.filter(
          (b) => timeToMinutes(b.end_time) > openMin && timeToMinutes(b.start_time) < closeMin,
        );
        const outCount = row.chips.length - inWindow.length;
        // 同一スタッフ・同時間帯の重複をレーン（段）に分割し、下のチップが隠れないようにする
        const { lanes, laneCount } = assignLanes(
          inWindow.map((b) => ({ start: timeToMinutes(b.start_time), end: timeToMinutes(b.end_time) })),
        );
        const LANE_H = 28;
        const rowHeight = Math.max(56, laneCount * LANE_H);
        const laneH = rowHeight / laneCount;
        return (
          <div key={row.key} className="flex border-b last:border-b-0 hover:bg-sky-50/30">
            <div className="w-36 shrink-0 px-3 py-2 border-r sticky left-0 z-10 bg-white">
              <p className="text-sm font-bold text-gray-800 truncate">{row.name}</p>
              {row.position && <p className="text-[10px] text-gray-400 truncate">{row.position}</p>}
              {outCount > 0 && (
                <p className="text-[10px] font-bold text-amber-600">営業時間外 {outCount}件</p>
              )}
            </div>
            <div
              role="button"
              tabIndex={0}
              aria-label={`${row.name} の空き時間に新規予約を追加`}
              className="flex-1 relative cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400"
              style={{ height: rowHeight }}
              onPointerDown={handleTrackPointerDown}
              onMouseDown={handleTrackPointerDown}
              onClick={(e) => handleTrackClick(e, row)}
              onKeyDown={(e) => handleTrackKeyDown(e, row)}
              title="クリック / Enter で新規予約"
            >
              {hours.map((h, i) => (
                <div key={h} className="absolute top-0 bottom-0 border-l border-gray-100" style={{ left: `${(i / hours.length) * 100}%` }} />
              ))}
              {inWindow.map((b, idx) => {
                const rawStart = timeToMinutes(b.start_time);
                const rawEnd = timeToMinutes(b.end_time);
                const start = Math.max(rawStart - openMin, 0);
                const end = Math.min(rawEnd - openMin, totalMin);
                const left = (start / totalMin) * 100;
                const width = Math.max(((end - start) / totalMin) * 100, 2);
                const lane = lanes[idx];
                const clipL = rawStart < openMin;
                const clipR = rawEnd > closeMin;
                return (
                  <Link
                    key={b.id}
                    href={`/admin/bookings/${b.id}`}
                    className={`absolute rounded border-l-4 px-1.5 overflow-hidden shadow-sm hover:shadow transition-shadow flex flex-col justify-center ${statusGanttClass(b.status)}`}
                    style={{ left: `${left}%`, width: `${width}%`, top: lane * laneH + 2, height: laneH - 4 }}
                    title={`${b.customer_name} 様 ${b.start_time.slice(0, 5)}〜${b.end_time.slice(0, 5)}${b.menuName ? ` / ${b.menuName}` : ''}${clipL ? '（早朝に続く）' : ''}${clipR ? '（営業時間外に続く）' : ''}`}
                  >
                    <p className="text-[11px] font-bold truncate leading-tight">{clipL ? '◀ ' : ''}{b.customer_name} 様</p>
                    {laneH >= 40 && (
                      <p className="text-[10px] truncate leading-tight">
                        {b.start_time.slice(0, 5)}〜{b.end_time.slice(0, 5)}{clipR ? ' ▶' : ''}{b.menuName ? ` ${b.menuName}` : ''}
                      </p>
                    )}
                  </Link>
                );
              })}
              {row.chips.length === 0 && (
                <p className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-400 select-none pointer-events-none">クリックで予約追加</p>
              )}
            </div>
          </div>
        );
      })}

      {modalOpen && (
        <BoardBookingModal
          facilityId={facilityId}
          date={date}
          closeHour={closeHour}
          menus={menus}
          staffOptions={staffOptions}
          preset={preset}
          onClose={() => setModalOpen(false)}
          onRefresh={() => router.refresh()}
          onCreated={() => {
            setModalOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function BoardBookingModal({
  facilityId,
  date,
  closeHour,
  menus,
  staffOptions,
  preset,
  onClose,
  onRefresh,
  onCreated,
}: {
  facilityId: string;
  date: string;
  closeHour: number;
  menus: BoardMenu[];
  staffOptions: StaffOption[];
  preset: { staffKey: string; start: string };
  onClose: () => void;
  onRefresh: () => void;
  onCreated: () => void;
}) {
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedMenus, setSelectedMenus] = useState<string[]>([]);
  const [startTime, setStartTime] = useState(preset.start);
  const [staffKey, setStaffKey] = useState(preset.staffKey); // M3: 担当をモーダル内で変更可能
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedStaff = staffOptions.find((s) => s.key === staffKey);
  const staffName = selectedStaff?.name ?? '指名なし';
  const nominationFee = staffKey === '__unassigned__' ? 0 : (selectedStaff?.nominationFee ?? 0);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // 入力途中の誤閉じで内容を失わないための破棄確認（R7）
  const dirty = customerName.trim() !== '' || email.trim() !== '' || phone.trim() !== '' || selectedMenus.length > 0;
  // 入力途中の破棄確認は window.confirm でなく共通 ConfirmDialog に統一（UI 二重基準を排除）。
  const [showDiscard, setShowDiscard] = useState(false);
  const showDiscardRef = useRef(false); // ESC ハンドラ（document リスナ）から最新状態を読むため
  const closeRef = useRef<() => void>(() => {});
  function handleClose() {
    if (dirty) {
      showDiscardRef.current = true;
      setShowDiscard(true);
      return;
    }
    onClose();
  }
  closeRef.current = handleClose;

  // ダイアログ a11y（R6）: 開いた時に最初の入力へフォーカス、ESC で閉じる、Tab をモーダル内に閉じ込め、
  // 閉じたら起点（呼び出し元）へフォーカスを戻す。
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // 破棄確認ダイアログ表示中は ConfirmDialog 側の ESC（キャンセル）に委ね、二重処理しない
        if (showDiscardRef.current) return;
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      prevFocus?.focus?.();
    };
  }, []);

  // 選択メニューの合計時間（分）から終了時刻を算出（最低30分）
  const pickedMenus = menus.filter((m) => selectedMenus.includes(m.id));
  const totalDuration = pickedMenus.reduce((s, m) => s + (m.duration_minutes || 0), 0);
  // M2: 所要時間が未設定のメニューがあると終了時刻が不正確になるため警告する
  const hasUnknownDuration = pickedMenus.some((m) => !m.duration_minutes);
  const endMin = computeEndMinutes(timeToMinutes(startTime), totalDuration);
  const endTime = minutesToTime(endMin);
  // 終了が営業終了（closeHour）を超える＝不正時刻(24:00超含む)になる前にブロックする（API 400 を予防）
  const tooLate = endExceedsClose(endMin, closeHour);

  // M1: フロント合計にスタッフ指名料を含め、サーバ計算（route.ts）と一致させる
  const menuPrice = pickedMenus.reduce((s, m) => s + (m.price || 0), 0);
  const totalPrice = menuPrice + nominationFee;

  function toggleMenu(id: string) {
    setSelectedMenus((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    if (submitting) return; // 二重送信ガード
    setError(null);
    if (!customerName.trim()) {
      setError('お客様名を入力してください');
      return;
    }
    if (selectedMenus.length === 0) {
      setError('メニューを1つ以上選択してください');
      return;
    }
    // M4: メール・電話のフロント検証（サーバ往復前に即フィードバック）
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('メールアドレスの形式が正しくありません');
      return;
    }
    if (phone.trim() && !/^[\d-]{1,20}$/.test(phone.trim())) {
      setError('電話番号は数字とハイフンで入力してください');
      return;
    }
    if (tooLate) {
      setError(`終了時刻（${endTime}）が営業終了（${minutesToTime(closeHour * 60)}）を超えます。開始時刻かメニューを調整してください。`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facility_id: facilityId,
          staff_id: staffKey === '__unassigned__' ? null : staffKey,
          menu_ids: selectedMenus,
          booking_date: date,
          start_time: startTime,
          end_time: endTime,
          customer_name: customerName.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // M5: 重複(409)時はボードを再取得し、最新の埋まり状況を背後に反映（モーダルは開いたまま）
        if (res.status === 409) {
          setError('この時間帯は既に予約が入っています。ボードを更新したので別の時間帯を選んでください。');
          onRefresh();
        } else {
          setError(data.error || '予約の作成に失敗しました');
        }
        setSubmitting(false);
        return;
      }
      onCreated();
    } catch {
      setError('通信エラーが発生しました');
      setSubmitting(false);
    }
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={handleClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-modal-title"
        className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 id="board-modal-title" className="text-sm font-bold text-gray-800">新規予約（{staffName}）</h2>
          <button type="button" onClick={handleClose} aria-label="閉じる" className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-xs text-gray-500">
            {date}　{startTime}〜{endTime}
          </div>
          {tooLate && (
            <p role="alert" className="text-xs text-red-600">
              終了時刻（{endTime}）が営業終了（{minutesToTime(closeHour * 60)}）を超えます。開始時刻かメニューを調整してください。
            </p>
          )}

          {/* M3: 担当をその場で変更可能。指名料は合計に反映（M1） */}
          <div>
            <label htmlFor="board-staff" className="block text-xs font-bold text-gray-600 mb-1">担当</label>
            <select
              id="board-staff"
              value={staffKey}
              onChange={(e) => setStaffKey(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
            >
              {staffOptions.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}{s.nominationFee > 0 ? `（指名料 ¥${s.nominationFee.toLocaleString()}）` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="board-customer-name" className="block text-xs font-bold text-gray-600 mb-1">お客様名 <span className="text-red-500">必須</span></label>
            <input
              id="board-customer-name"
              ref={firstFieldRef}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              maxLength={100}
              className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="board-email" className="block text-xs font-bold text-gray-600 mb-1">メール（任意）</label>
              <input
                id="board-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
            </div>
            <div>
              <label htmlFor="board-phone" className="block text-xs font-bold text-gray-600 mb-1">電話（任意）</label>
              <input
                id="board-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={20}
                className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
            </div>
          </div>

          <div>
            <label htmlFor="board-start-time" className="block text-xs font-bold text-gray-600 mb-1">開始時刻</label>
            <input
              id="board-start-time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              step={1800}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">メニュー <span className="text-red-500">必須</span></label>
            {menus.length === 0 ? (
              <p className="text-xs text-gray-400">
                メニューが登録されていません。<Link href="/admin/menus" className="text-sky-600 underline">メニューを登録</Link>
              </p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto border border-gray-100 rounded-md p-2">
                {menus.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-sky-50 rounded px-1 py-0.5">
                    <input type="checkbox" checked={selectedMenus.includes(m.id)} onChange={() => toggleMenu(m.id)} />
                    <span className="flex-1 truncate">{m.name}</span>
                    <span className="text-xs text-gray-400">
                      {m.duration_minutes ? `${m.duration_minutes}分` : ''}{m.price != null ? ` ¥${m.price.toLocaleString()}` : ''}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {hasUnknownDuration && (
              <p className="text-[11px] text-amber-600 mt-1">
                所要時間が未設定のメニューがあります。終了時刻は仮（最低30分）で計算しています。
              </p>
            )}
          </div>

          <div className="text-sm pt-1 space-y-0.5">
            {nominationFee > 0 && (
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>うち指名料</span>
                <span>¥{nominationFee.toLocaleString()}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-gray-500">合計</span>
              <span className="font-bold text-gray-800">¥{totalPrice.toLocaleString()}</span>
            </div>
          </div>

          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          <button type="button" onClick={handleClose} className="px-3 py-1.5 rounded-md text-sm text-gray-600 hover:bg-gray-100">キャンセル</button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || tooLate}
            className="px-4 py-1.5 rounded-md text-sm font-bold bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {submitting ? '作成中…' : '予約を確定'}
          </button>
        </div>
      </div>
    </div>
    <ConfirmDialog
      open={showDiscard}
      title="入力内容を破棄"
      message="入力内容を破棄して閉じますか？"
      confirmLabel="破棄して閉じる"
      cancelLabel="編集を続ける"
      onConfirm={() => { showDiscardRef.current = false; setShowDiscard(false); onClose(); }}
      onCancel={() => { showDiscardRef.current = false; setShowDiscard(false); }}
    />
    </>
  );
}
