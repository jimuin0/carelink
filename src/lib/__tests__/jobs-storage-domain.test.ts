import { jobFormSchema } from '../jobs';
const job={title:'Synthetic',job_type:'Stylist',employment_type:'正社員'};
for(const field of ['salary_min','salary_max']){
 test.each([0.5,'0.5',2147483648,'2147483648'])('%s rejects non-integer/out-of-DB-domain salary '+field,amount=>{expect(jobFormSchema.safeParse({...job,[field]:amount}).success).toBe(false);});
 test.each([0,'0',2147483647,'2147483647'])('accepts DB integer boundary %s '+field,amount=>{expect(jobFormSchema.safeParse({...job,[field]:amount}).success).toBe(true);});
}
