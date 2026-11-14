import { applicationCreateSchema } from '../job-application-validation';

const base = { facility_id: '11111111-1111-4111-8111-111111111111', applicant_name: '応募者' };

describe('applicationCreateSchema の applicant_email（点検 A412）', () => {
  it('大文字小文字・前後の空白が違うだけのアドレスは同じ値に正規化される（重複応募を一意制約で止めるため）', () => {
    const a = applicationCreateSchema.parse({ ...base, applicant_email: 'Foo@Example.com' });
    const b = applicationCreateSchema.parse({ ...base, applicant_email: ' foo@example.com ' });
    expect(a.applicant_email).toBe('foo@example.com');
    expect(b.applicant_email).toBe(a.applicant_email);
  });

  it('形式が不正なアドレスは従来どおり拒否する', () => {
    expect(applicationCreateSchema.safeParse({ ...base, applicant_email: 'not-an-email' }).success).toBe(false);
  });
});
