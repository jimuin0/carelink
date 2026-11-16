jest.mock('../registration-flow',()=>({REGISTRATION_STEPS:[]}));
import { lineSupportKnowledge,publicLineSupportAnswer } from '../line-support-knowledge';
test('removed document definitions fail closed rather than reusing an unrelated registration step',()=>{
 const facts=lineSupportKnowledge('a'.repeat(40));expect(facts.facts.documentRequirement).toBeNull();expect(publicLineSupportAnswer('書類は必要ですか',facts)).toBeNull();
});
