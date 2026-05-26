/**
 * 予約バリデーション + onboarding ロジックのユニットテスト
 */

describe('予約日付バリデーション', () => {
  function isValidBookingDate(dateStr: string): boolean {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // 過去日付は不可
    if (date < today) return false;
    // 90日以上先は不可
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 90);
    if (date > maxDate) return false;
    return true;
  }

  // ローカル日付 → 'YYYY-MM-DD' 変換（toISOString は UTC のため、JST 00-09時帯で
  // 日付がずれて isValidBookingDate と比較ずれを起こすバグを回避）
  function localDateString(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  test('今日の日付は有効', () => {
    const today = localDateString(new Date());
    expect(isValidBookingDate(today)).toBe(true);
  });

  test('明日の日付は有効', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(isValidBookingDate(localDateString(tomorrow))).toBe(true);
  });

  test('昨日の日付は無効', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isValidBookingDate(yesterday.toISOString().split('T')[0])).toBe(false);
  });

  test('91日後の日付は無効', () => {
    const future = new Date();
    future.setDate(future.getDate() + 91);
    expect(isValidBookingDate(future.toISOString().split('T')[0])).toBe(false);
  });

  test('不正な日付文字列は無効', () => {
    expect(isValidBookingDate('not-a-date')).toBe(false);
    expect(isValidBookingDate('')).toBe(false);
    expect(isValidBookingDate('2026-13-01')).toBe(false); // invalid month
  });
});

describe('予約時間スロットバリデーション', () => {
  function isValidTimeSlot(time: string): boolean {
    const match = time.match(/^(\d{2}):(\d{2})$/);
    if (!match) return false;
    const hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    if (hours < 0 || hours > 23) return false;
    if (minutes !== 0 && minutes !== 30) return false; // 30分刻み
    return true;
  }

  test('有効な時刻（30分刻み）', () => {
    expect(isValidTimeSlot('09:00')).toBe(true);
    expect(isValidTimeSlot('09:30')).toBe(true);
    expect(isValidTimeSlot('18:00')).toBe(true);
    expect(isValidTimeSlot('23:30')).toBe(true);
  });

  test('無効な時刻', () => {
    expect(isValidTimeSlot('24:00')).toBe(false);
    expect(isValidTimeSlot('09:15')).toBe(false); // 30分刻みでない
    expect(isValidTimeSlot('9:00')).toBe(false);   // ゼロパディングなし
    expect(isValidTimeSlot('')).toBe(false);
  });
});

describe('予約メモバリデーション', () => {
  function validateBookingNote(note: string): { valid: boolean; error?: string } {
    if (note.length > 500) {
      return { valid: false, error: '備考は500文字以内で入力してください' };
    }
    // XSS防止: HTMLタグチェック（サーバー側でも必要だがクライアント側でも）
    if (/<[^>]*>/.test(note)) {
      return { valid: false, error: 'HTMLタグは使用できません' };
    }
    return { valid: true };
  }

  test('空メモは有効', () => {
    expect(validateBookingNote('')).toEqual({ valid: true });
  });

  test('500文字以内は有効', () => {
    const note = 'a'.repeat(500);
    expect(validateBookingNote(note)).toEqual({ valid: true });
  });

  test('501文字以上は無効', () => {
    const note = 'a'.repeat(501);
    expect(validateBookingNote(note).valid).toBe(false);
    expect(validateBookingNote(note).error).toMatch(/500文字/);
  });

  test('HTMLタグを含む場合は無効', () => {
    expect(validateBookingNote('<script>alert(1)</script>').valid).toBe(false);
    expect(validateBookingNote('<img src=x onerror=alert(1)>').valid).toBe(false);
  });
});

describe('オンボーディング進捗計算', () => {
  type OnboardingStep = 'menu' | 'staff' | 'photo' | 'schedule' | 'publish';

  function calcProgress(completed: OnboardingStep[]): number {
    const TOTAL_STEPS = 5;
    return Math.round((completed.length / TOTAL_STEPS) * 100);
  }

  function getNextStep(completed: OnboardingStep[]): OnboardingStep | null {
    const ALL_STEPS: OnboardingStep[] = ['menu', 'staff', 'photo', 'schedule', 'publish'];
    return ALL_STEPS.find((s) => !completed.includes(s)) || null;
  }

  test('0ステップ完了で0%', () => {
    expect(calcProgress([])).toBe(0);
  });

  test('1ステップ完了で20%', () => {
    expect(calcProgress(['menu'])).toBe(20);
  });

  test('全ステップ完了で100%', () => {
    expect(calcProgress(['menu', 'staff', 'photo', 'schedule', 'publish'])).toBe(100);
  });

  test('次のステップを正しく返す', () => {
    expect(getNextStep([])).toBe('menu');
    expect(getNextStep(['menu'])).toBe('staff');
    expect(getNextStep(['menu', 'staff', 'photo', 'schedule', 'publish'])).toBeNull();
  });
});
