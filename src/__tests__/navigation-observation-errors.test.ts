/** @jest-environment node */
import { navigationErrorClassification, navigationTransportFailure } from '../../e2e/helpers/navigation-observation-errors';
test('page errors expose classifications only, never raw message, secret URL or stack',()=>{
 const e=new Error('Failed to fetch https://example.invalid?private=synthetic');e.name='UnexpectedPrivateName';
 expect(navigationErrorClassification(e)).toEqual({errorName:'other',reactCode:null,transportFailure:true,aborted:false,chunkLoadFailure:false,undefinedReference:false});
 expect(JSON.stringify(navigationErrorClassification(e))).not.toContain('synthetic');
});
test.each(['TypeError','ReferenceError','AbortError','AuthRetryableFetchError'])('known error name %s is preserved without detail',name=>{
 const e=new Error('synthetic');e.name=name;expect(navigationErrorClassification(e).errorName).toBe(name);
});
test('React, abort, chunk and missing-reference classes are independent',()=>{
 expect(navigationErrorClassification(new Error('Minified React error #418; aborted Loading chunk is not defined'))).toMatchObject({reactCode:'418',aborted:true,chunkLoadFailure:true,undefinedReference:true});
});
test.each(['ERR_ABORTED','ERR_CONNECTION_CLOSED','ERR_CONNECTION_RESET','ERR_TIMED_OUT','ERR_FAILED'])('only fixed transport code %s is retained',code=>{
 expect(navigationTransportFailure('private '+code+' https://example.invalid?private=synthetic')).toBe(code);
});
test('WebKit cancellation and unknown transport text are sanitized',()=>{
 expect(navigationTransportFailure('request cancelled')).toBe('cancelled');expect(navigationTransportFailure('private synthetic')).toBe('other');
});
