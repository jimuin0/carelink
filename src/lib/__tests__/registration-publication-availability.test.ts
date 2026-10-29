/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { registrationPublicationAvailable } from '../registration-publication-availability';
const id='22222222-2222-4222-8222-222222222222';
function fixture(result: unknown) {
 const query={ select:jest.fn(),eq:jest.fn(),maybeSingle:jest.fn().mockResolvedValue(result) };
 query.select.mockReturnValue(query);query.eq.mockReturnValue(query);
 const db={from:jest.fn().mockReturnValue(query)};
 return {db:db as unknown as Parameters<typeof registrationPublicationAvailable>[0],query,from:db.from};
}
test('only an exact marker for the selected receipt permits the hint',async()=>{
 const f=fixture({data:{receipt_id:id},error:null});expect(await registrationPublicationAvailable(f.db,id)).toBe(true);
 expect(f.from).toHaveBeenCalledWith('salon_registration_publication');expect(f.query.eq).toHaveBeenCalledWith('receipt_id',id);
});
test('old receipts have no publication marker',async()=>{
 const f=fixture({data:null,error:null});expect(await registrationPublicationAvailable(f.db,id)).toBe(false);
});
test.each([{data:null,error:{}},{data:{receipt_id:'another'},error:null}])('database failures or inconsistent rows never authorize',async result=>{
 const f=fixture(result);await expect(registrationPublicationAvailable(f.db,id)).rejects.toThrow('REGISTRATION_PUBLICATION_UNAVAILABLE');
});
test('invalid receipt never reaches the database',async()=>{
 const f=fixture(null);await expect(registrationPublicationAvailable(f.db,'bad')).rejects.toThrow('REGISTRATION_PUBLICATION_UNAVAILABLE');expect(f.from).not.toHaveBeenCalled();
});
