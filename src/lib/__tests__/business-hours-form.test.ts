import { copyFirstHoursToOpenDays, initialHoursForm, validateHoursForm, type HoursDraft } from '../business-hours-form';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const blank = (): HoursDraft => Object.fromEntries(DAYS.map(d => [d, { open: '', close: '' }]));

describe('initialHoursForm', () => {
  // 新しい店舗に 09:00〜19:00 を黙って入れていた（チェック1つで既定値が確定し、スタッフの下書きにも流れた）。
  test.each([null, undefined, 'x', [], {}])('保存されていなければ全曜日を空欄のまま始める（既定値で埋めない）：%p', (saved) => {
    expect(initialHoursForm(saved)).toEqual({ hours: blank(), closedDays: [] });
  });

  test('保存済みの時間と定休日を復元する（秒は落とす）。保存されていない曜日は空欄', () => {
    const { hours, closedDays } = initialHoursForm({
      mon: { open: '10:00:00', close: '19:30' }, tue: null, wed: { open: 9 }, thu: 'broken',
    });
    expect(closedDays).toEqual(['tue']);
    expect(hours.mon).toEqual({ open: '10:00', close: '19:30' });
    expect(hours.tue).toEqual({ open: '', close: '' });
    expect(hours.wed).toEqual({ open: '', close: '' });
    expect(hours.thu).toEqual({ open: '', close: '' });
    expect(hours.sun).toEqual({ open: '', close: '' });
  });
});

describe('validateHoursForm', () => {
  const filled = (): HoursDraft => Object.fromEntries(DAYS.map(d => [d, { open: '10:00', close: '19:00' }]));

  test('全曜日が入力済み・定休日は null で7曜日そろえる', () => {
    expect(validateHoursForm(filled(), ['sun'])).toEqual({
      ok: true,
      value: { ...Object.fromEntries(DAYS.map(d => [d, { open: '10:00', close: '19:00' }])), sun: null },
    });
  });

  test('空欄の営業日があれば保存させず、どの曜日かを示す', () => {
    const hours = filled(); hours.wed = { open: '10:00', close: '' };
    expect(validateHoursForm(hours, [])).toEqual({ ok: false, message: '水曜日の開店・閉店時間を入力してください（休みの曜日は「営業」のチェックを外してください）' });
  });

  test('入力欄の無い曜日も空欄として扱う', () => {
    const hours = filled(); delete hours.fri;
    expect(validateHoursForm(hours, [])).toMatchObject({ ok: false, message: expect.stringContaining('金曜日') });
  });

  test('閉店が開店以前なら保存させない', () => {
    const hours = filled(); hours.mon = { open: '19:00', close: '19:00' };
    expect(validateHoursForm(hours, [])).toEqual({ ok: false, message: '月曜日の閉店時間は開店時間より後にしてください' });
  });

  test('全曜日を休みにはできない', () => {
    expect(validateHoursForm(blank(), DAYS)).toEqual({ ok: false, message: '営業する曜日を1日以上入力してください' });
  });
});

describe('copyFirstHoursToOpenDays', () => {
  test('最初に入力した営業日の時間を他の営業日へ写す（定休日は空欄のまま）', () => {
    const hours = blank(); hours.tue = { open: '11:00', close: '20:00' }; hours.mon = { open: '09:00', close: '' };
    const next = copyFirstHoursToOpenDays(hours, ['sun']);
    expect(next?.mon).toEqual({ open: '11:00', close: '20:00' });
    expect(next?.sat).toEqual({ open: '11:00', close: '20:00' });
    expect(next?.sun).toEqual({ open: '', close: '' });
  });

  test('定休日に入っている時間は写す元にしない', () => {
    const hours = blank(); hours.mon = { open: '09:00', close: '18:00' };
    expect(copyFirstHoursToOpenDays(hours, ['mon'])).toBeNull();
  });

  test('写す元が無ければ null', () => {
    const hours = blank(); delete hours.mon;
    expect(copyFirstHoursToOpenDays(hours, [])).toBeNull();
  });
});
