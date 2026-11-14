/**
 * Tests for lib/jobs.ts — jobFormSchema zod validation
 * Covers all branches: required fields, length limits, salary union+refine, salary_min/max ordering.
 */

import { jobFormSchema, EMPLOYMENT_TYPES } from '../jobs';

describe('EMPLOYMENT_TYPES', () => {
  test('contains expected 5 values', () => {
    expect(EMPLOYMENT_TYPES).toHaveLength(5);
    expect(EMPLOYMENT_TYPES).toContain('正社員');
    expect(EMPLOYMENT_TYPES).toContain('業務委託');
  });
});

describe('jobFormSchema — minimal valid input', () => {
  test('parses required fields only', () => {
    const r = jobFormSchema.safeParse({
      title: 'Test Title',
      job_type: 'engineer',
      employment_type: '正社員',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.title).toBe('Test Title');
      expect(r.data.salary_min).toBeNull();
      expect(r.data.salary_max).toBeNull();
    }
  });
});

describe('jobFormSchema — title', () => {
  test('rejects empty title', () => {
    const r = jobFormSchema.safeParse({ title: '   ', job_type: 'x', employment_type: '正社員' });
    expect(r.success).toBe(false);
  });

  test('rejects title over 120 chars', () => {
    const r = jobFormSchema.safeParse({
      title: 'a'.repeat(121),
      job_type: 'x',
      employment_type: '正社員',
    });
    expect(r.success).toBe(false);
  });
});

describe('jobFormSchema — job_type', () => {
  test('rejects empty job_type', () => {
    const r = jobFormSchema.safeParse({ title: 'OK', job_type: '', employment_type: '正社員' });
    expect(r.success).toBe(false);
  });

  test('rejects job_type over 60 chars', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'a'.repeat(61),
      employment_type: '正社員',
    });
    expect(r.success).toBe(false);
  });
});

describe('jobFormSchema — employment_type enum', () => {
  test('accepts all EMPLOYMENT_TYPES values', () => {
    for (const t of EMPLOYMENT_TYPES) {
      const r = jobFormSchema.safeParse({ title: 'OK', job_type: 'x', employment_type: t });
      expect(r.success).toBe(true);
    }
  });

  test('rejects invalid employment_type', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: 'インターン' as never,
    });
    expect(r.success).toBe(false);
  });
});

describe('jobFormSchema — salary fields union transform', () => {
  test('salary_min empty string → null', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_min: '',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.salary_min).toBeNull();
  });

  test('salary_min undefined → null', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_min: undefined,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.salary_min).toBeNull();
  });

  test('salary_min numeric string → number', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_min: '3000',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.salary_min).toBe(3000);
  });

  test('salary_min as number passes', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_min: 5000,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.salary_min).toBe(5000);
  });

  test('salary_min/max が null でも受理（冪等再検証＝給与未入力の求人作成が POST 再検証で 400 にならない）', () => {
    // フォームが zodResolver で空欄→null に変換した値を、API ルートが同じスキーマで
    // 再検証する経路。null を弾くと給与未入力の求人作成が 400 になる回帰の固定。
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_min: null,
      salary_max: null,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.salary_min).toBeNull();
      expect(r.data.salary_max).toBeNull();
    }
  });

  test('salary_min negative → refine fails', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_min: -1,
    });
    expect(r.success).toBe(false);
  });

  test('salary_min non-finite (NaN) → refine fails', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_min: 'abc',
    });
    expect(r.success).toBe(false);
  });

  test('salary_max same transform & refine works', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_max: -5,
    });
    expect(r.success).toBe(false);
  });

  test('salary_max が空文字 → null に変換される（L18 ConditionalExpression / StringLiteral mutation kill）', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_max: '',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.salary_max).toBeNull();
  });
});

describe('jobFormSchema — salary_min <= salary_max refine', () => {
  test('max < min fails', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_min: 5000,
      salary_max: 3000,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes('salary_max'))).toBe(true);
    }
  });

  test('max >= min passes', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_min: 3000,
      salary_max: 5000,
    });
    expect(r.success).toBe(true);
  });

  test('salary_min null skips ordering check', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_max: 5000,
    });
    expect(r.success).toBe(true);
  });

  test('salary_max null skips ordering check', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_min: 5000,
    });
    expect(r.success).toBe(true);
  });
});

describe('jobFormSchema — optional text fields', () => {
  test('empty string literal accepted for salary_note', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_note: '',
    });
    expect(r.success).toBe(true);
  });

  test('salary_note over 200 chars fails', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_note: 'a'.repeat(201),
    });
    expect(r.success).toBe(false);
  });

  test('description over 4000 chars fails', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      description: 'a'.repeat(4001),
    });
    expect(r.success).toBe(false);
  });

  test('requirements/benefits over 2000 chars fails', () => {
    const r1 = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      requirements: 'a'.repeat(2001),
    });
    const r2 = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      benefits: 'a'.repeat(2001),
    });
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
  });

  test('empty string for description/requirements/benefits accepted', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      description: '',
      requirements: '',
      benefits: '',
    });
    expect(r.success).toBe(true);
  });
});

// Branch coverage: line 26 (×2)
// refine: v.salary_min === null || v.salary_max === null || (v.salary_max ?? 0) >= (v.salary_min ?? 0)
// The ?? 0 fallback in (v.salary_max ?? 0) and (v.salary_min ?? 0) represents uncovered branches.
// These tests ensure both the null-coalescing branches and the refine result branches are covered.
describe('jobFormSchema — salary refine null-coalescing branches (line 26)', () => {
  // Branch coverage: line 26 — salary_min=0, salary_max=0 → equality passes refine
  test('salary_min=0 and salary_max=0 → equal, passes refine', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_min: 0,
      salary_max: 0,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.salary_min).toBe(0);
      expect(r.data.salary_max).toBe(0);
    }
  });

  // Branch coverage: line 26 — both salary_min and salary_max provided as strings → numeric comparison
  test('salary_min="1000" and salary_max="2000" as strings → passes refine', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_min: '1000',
      salary_max: '2000',
    });
    expect(r.success).toBe(true);
  });

  // Branch coverage: line 26 — max strictly equal to min passes
  test('salary_min=5000, salary_max=5000 → exact equal passes', () => {
    const r = jobFormSchema.safeParse({
      title: 'OK',
      job_type: 'x',
      employment_type: '正社員',
      salary_min: 5000,
      salary_max: 5000,
    });
    expect(r.success).toBe(true);
  });
});

describe('給与の単位（点検 B8-L5）', () => {
  const { SALARY_UNITS, SALARY_UNIT_LABELS, SALARY_UNIT_LD, toSalaryUnit, jobFormSchema: schema } = jest.requireActual('../jobs');
  const base = { title: 'T', job_type: '美容師', employment_type: '正社員' };

  test('単位は DB の CHECK と同じ 4 種で、表示名と JSON-LD の値を持つ', () => {
    expect(SALARY_UNITS).toEqual(['monthly', 'hourly', 'daily', 'yearly']);
    expect(SALARY_UNIT_LABELS).toEqual({ monthly: '月給', hourly: '時給', daily: '日給', yearly: '年俸' });
    expect(SALARY_UNIT_LD).toEqual({ monthly: 'MONTH', hourly: 'HOUR', daily: 'DAY', yearly: 'YEAR' });
  });

  test.each([['hourly', 'hourly'], ['yearly', 'yearly'], ['weekly', 'monthly'], ['', 'monthly'], [null, 'monthly'], [undefined, 'monthly']])(
    'toSalaryUnit(%p) → %p', (input, expected) => { expect(toSalaryUnit(input)).toBe(expected); },
  );

  test('未指定は月給、指定した単位はそのまま、未知の単位は拒否', () => {
    expect(schema.parse(base).salary_unit).toBe('monthly');
    expect(schema.parse({ ...base, salary_unit: 'daily' }).salary_unit).toBe('daily');
    const r = schema.safeParse({ ...base, salary_unit: 'weekly' });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toBe('給与の単位を選択してください');
  });
});
