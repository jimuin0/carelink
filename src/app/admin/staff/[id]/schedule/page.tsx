'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

interface Schedule {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

interface Override {
  id: string;
  date: string;
  is_holiday: boolean;
  start_time: string | null;
  end_time: string | null;
}

export default function StaffSchedulePage() {
  const params = useParams();
  const router = useRouter();
  const staffId = params.id as string;
  const [staffName, setStaffName] = useState('');
  const [schedules, setSchedules] = useState<Schedule[]>(
    DAY_LABELS.map((_, i) => ({ day_of_week: i, start_time: '09:00', end_time: '19:00' }))
  );
  const [enabledDays, setEnabledDays] = useState<boolean[]>(Array(7).fill(true));
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [newOverrideDate, setNewOverrideDate] = useState('');
  const [newOverrideHoliday, setNewOverrideHoliday] = useState(true);
  const [newOverrideStart, setNewOverrideStart] = useState('09:00');
  const [newOverrideEnd, setNewOverrideEnd] = useState('19:00');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadData = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    const { data: staff } = await supabase.from('staff_profiles').select('name').eq('id', staffId).single();
    if (staff) setStaffName(staff.name);

    const { data: schData } = await supabase
      .from('staff_schedules')
      .select('day_of_week, start_time, end_time')
      .eq('staff_id', staffId)
      .order('day_of_week');

    if (schData && schData.length > 0) {
      const newSchedules = DAY_LABELS.map((_, i) => {
        const existing = schData.find((s) => s.day_of_week === i);
        return existing || { day_of_week: i, start_time: '09:00', end_time: '19:00' };
      });
      setSchedules(newSchedules);
      setEnabledDays(DAY_LABELS.map((_, i) => schData.some((s) => s.day_of_week === i)));
    }

    const { data: ovData } = await supabase
      .from('schedule_overrides')
      .select('id, date, is_holiday, start_time, end_time')
      .eq('staff_id', staffId)
      .gte('date', new Date().toISOString().split('T')[0])
      .order('date');
    if (ovData) setOverrides(ovData);
  }, [staffId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSaveSchedules = async () => {
    setSaving(true);
    try {
      const supabase = createBrowserSupabaseClient();
      // Delete existing then insert enabled days
      await supabase.from('staff_schedules').delete().eq('staff_id', staffId);
      const rows = schedules
        .filter((_, i) => enabledDays[i])
        .map((s) => ({ staff_id: staffId, day_of_week: s.day_of_week, start_time: s.start_time, end_time: s.end_time }));
      if (rows.length > 0) {
        const { error } = await supabase.from('staff_schedules').insert(rows);
        if (error) { setToast({ type: 'error', message: '保存に失敗しました' }); return; }
      }
      setToast({ type: 'success', message: 'スケジュールを保存しました' });
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setSaving(false);
    }
  };

  const handleAddOverride = async () => {
    if (!newOverrideDate) return;
    try {
      const supabase = createBrowserSupabaseClient();
      const row: Record<string, unknown> = {
        staff_id: staffId,
        date: newOverrideDate,
        is_holiday: newOverrideHoliday,
      };
      if (!newOverrideHoliday) {
        row.start_time = newOverrideStart;
        row.end_time = newOverrideEnd;
      }
      const { error } = await supabase.from('schedule_overrides').upsert(row, { onConflict: 'staff_id,date' });
      if (error) { setToast({ type: 'error', message: '追加に失敗しました' }); return; }
      setNewOverrideDate('');
      loadData();
      setToast({ type: 'success', message: '特別日を追加しました' });
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    }
  };

  const handleDeleteOverride = async (id: string) => {
    const supabase = createBrowserSupabaseClient();
    await supabase.from('schedule_overrides').delete().eq('id', id);
    setOverrides((prev) => prev.filter((o) => o.id !== id));
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button type="button" onClick={() => router.push('/admin/staff')} className="text-sm text-gray-500 hover:underline">← 戻る</button>
        <h1 className="text-2xl font-bold">{staffName}のスケジュール</h1>
      </div>

      {/* Weekly Schedule */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="font-bold mb-4">週間スケジュール</h2>
        <div className="space-y-3">
          {DAY_LABELS.map((label, i) => (
            <div key={i} className="flex items-center gap-3">
              <label className="flex items-center gap-2 w-16">
                <input
                  type="checkbox"
                  checked={enabledDays[i]}
                  onChange={(e) => {
                    const next = [...enabledDays];
                    next[i] = e.target.checked;
                    setEnabledDays(next);
                  }}
                />
                <span className="text-sm font-medium">{label}</span>
              </label>
              {enabledDays[i] ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={schedules[i].start_time}
                    onChange={(e) => {
                      const next = [...schedules];
                      next[i] = { ...next[i], start_time: e.target.value };
                      setSchedules(next);
                    }}
                    className="form-input !w-32 text-sm"
                  />
                  <span className="text-gray-400">〜</span>
                  <input
                    type="time"
                    value={schedules[i].end_time}
                    onChange={(e) => {
                      const next = [...schedules];
                      next[i] = { ...next[i], end_time: e.target.value };
                      setSchedules(next);
                    }}
                    className="form-input !w-32 text-sm"
                  />
                </div>
              ) : (
                <span className="text-sm text-gray-400">休み</span>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={handleSaveSchedules} disabled={saving} className="btn-primary mt-4 !py-2">
          {saving ? '保存中...' : 'スケジュールを保存'}
        </button>
      </div>

      {/* Schedule Overrides */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="font-bold mb-4">特別日設定</h2>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">日付</label>
            <input
              type="date"
              value={newOverrideDate}
              onChange={(e) => setNewOverrideDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="form-input text-sm !w-40"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">種別</label>
            <select
              value={newOverrideHoliday ? 'holiday' : 'custom'}
              onChange={(e) => setNewOverrideHoliday(e.target.value === 'holiday')}
              className="form-input text-sm !w-28"
            >
              <option value="holiday">休み</option>
              <option value="custom">時間変更</option>
            </select>
          </div>
          {!newOverrideHoliday && (
            <>
              <div>
                <label className="text-xs text-gray-500 block mb-1">開始</label>
                <input type="time" value={newOverrideStart} onChange={(e) => setNewOverrideStart(e.target.value)} className="form-input text-sm !w-28" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">終了</label>
                <input type="time" value={newOverrideEnd} onChange={(e) => setNewOverrideEnd(e.target.value)} className="form-input text-sm !w-28" />
              </div>
            </>
          )}
          <button type="button" onClick={handleAddOverride} className="btn-primary text-sm !py-2 !px-4">追加</button>
        </div>

        {overrides.length === 0 ? (
          <p className="text-sm text-gray-400">特別日の設定はありません</p>
        ) : (
          <div className="space-y-2">
            {overrides.map((ov) => (
              <div key={ov.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                <div className="text-sm">
                  <span className="font-medium">{new Date(ov.date + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })}</span>
                  {ov.is_holiday ? (
                    <span className="ml-2 text-red-500">休み</span>
                  ) : (
                    <span className="ml-2 text-gray-600">{ov.start_time}〜{ov.end_time}</span>
                  )}
                </div>
                <button type="button" onClick={() => handleDeleteOverride(ov.id)} className="text-xs text-red-400 hover:text-red-600">削除</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
