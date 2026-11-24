/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('@anthropic-ai/sdk',()=>({__esModule:true,default:jest.fn()}));
jest.mock('../chat-rate-limit',()=>({checkChatLimit:jest.fn(),chatDailyLimit:jest.fn(),CHAT_DAILY_WINDOW_MS:86400000}));
import Anthropic from '@anthropic-ai/sdk';
import { checkChatLimit,chatDailyLimit } from '../chat-rate-limit';
import { generateLineSupportDraft,isDocumentQuestion,LINE_SUPPORT_DOCUMENT_REPLY,minimiseSupportContext,splitConsultation } from '../line-support-draft';
import { lineSupportKnowledge } from '../line-support-knowledge';
const create=jest.fn(); const env={...process.env};
const history=[{revision:1,message_type:'text',body:'ログインできません。'}];
const facts=lineSupportKnowledge('a'.repeat(40));const conversation='10000000-0000-4000-8000-000000000001';
beforeEach(()=>{jest.resetAllMocks();process.env={...env,ANTHROPIC_API_KEY:'synthetic',LINE_SUPPORT_CLAUDE_MODEL:'synthetic-model'};
 (chatDailyLimit as jest.Mock).mockReturnValue(10);(checkChatLimit as jest.Mock).mockResolvedValue('allowed');
 (Anthropic as unknown as jest.Mock).mockImplementation(()=>({messages:{create}}));
 create.mockResolvedValue({stop_reason:'end_turn',content:[{type:'tool_use',name:'ignored'},{type:'text',text:JSON.stringify({text:'状況を確認させてください。',missingInformation:['発生時刻'],sourceUrls:[],documentList:false})}]});});
afterEach(()=>{process.env={...env};});
test('generates a validated draft with bounded history and no tools or customer-send command',async()=>{
 const result=await generateLineSupportDraft(history,facts,conversation);expect(result.state).toBe('ready');
 expect(Anthropic).toHaveBeenCalledWith({apiKey:'synthetic',timeout:10000,maxRetries:0});
 expect(create.mock.calls[0][0]).toMatchObject({model:'synthetic-model',max_tokens:1200});
 expect(create.mock.calls[0][0].system).toContain('顧客には送信されません');
});
test('drafts use the requested CareLink plain text style even when the model adds pronunciation and emphasis',async()=>{
 create.mockResolvedValue({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({text:'CareLink(ケアリンク)／CareLink（ケアリンク）の**掲載料**についてご案内いたします。',missingInformation:[],sourceUrls:[],documentList:false})}]});
 const result=await generateLineSupportDraft(history,facts,conversation);
 expect(result).toMatchObject({state:'ready',draft:{text:'CareLink／CareLinkの掲載料についてご案内いたします。'}});
 expect(create.mock.calls[0][0].system).toContain('利用実績が不明な相手');
 expect(create.mock.calls[0][0].system).toContain('丁寧で親しみやすい');
});
test('drafts answer document timing concretely from published facts without repeating earlier topics',async()=>{
 await generateLineSupportDraft(history,facts,conversation);
 const system=create.mock.calls[0][0].system as string;
 expect(system).toContain('documentTiming');expect(system).toContain('acceptedDocuments');
 expect(system).toContain('聞かれたことだけ');expect(system).toContain('聞かれていない公開情報');expect(system).toContain('別の窓口へ誘導しない');expect(system).toContain('大丈夫です');expect(system).toContain('documentList を true');expect(system).toContain('決まった文面に差し替えます');expect(system).toContain('全文を書いて');expect(system).not.toContain('短い要約');expect(system).toContain('段落の間には空行');expect(system).toContain('提出猶予ではなく提出時期の相談');expect(system).toContain('公開後の提出でもよいと読める表現は使わない');
 const sent=JSON.parse(create.mock.calls[0][0].messages[0].content);expect(sent.question.revision).toBe(Math.max(...history.map(h=>h.revision)));expect(sent.earlierMessages).toHaveLength(history.length-1);
 expect(system).toContain('個別の提出猶予');
 for(const label of facts.facts.acceptedDocuments)expect(system).toContain(label);
});
test.each([[true,true],[false,false]])('documentList %s uses the fixed document reply: %s',async(flag,fixed)=>{
 const out={text:'掲載申込は先に送信できます。公官庁からの通知も対象です。',missingInformation:[],sourceUrls:[],documentList:flag};
 create.mockResolvedValue({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(out)}]});
 const result=await generateLineSupportDraft(history,facts,conversation);if(result.state!=='ready')throw new Error('not ready');
 expect(result.draft.text).toBe(fixed?LINE_SUPPORT_DOCUMENT_REPLY:'掲載申込は先に送信できます。官公庁からの通知も対象です。');
});
test('a response without the required flag is not used as a draft',async()=>{
 create.mockResolvedValue({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({text:'案',missingInformation:[],sourceUrls:[]})}]});
 expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('unavailable');
});
test('a listed form gets the fixed reply even when the model says it is not a document question',async()=>{
 create.mockResolvedValue({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({text:'短い要約です。',missingInformation:[],sourceUrls:[],documentList:false})}]});
 const doc=[{revision:1,message_type:'text',body:'掲載料はいくらですか'},{revision:2,message_type:'text',body:'開業届はまだ手元にないのですが、先に掲載申込できますか？'}];
 const result=await generateLineSupportDraft(doc,facts,conversation);if(result.state!=='ready')throw new Error('not ready');
 expect(result.draft.text).toBe(LINE_SUPPORT_DOCUMENT_REPLY);
});
test('only the newest message decides whether it is a document question',()=>{
 expect(isDocumentQuestion([{revision:1,message_type:'text',body:'書類について'},{revision:2,message_type:'text',body:'掲載料はいくらですか'}],false)).toBe(false);
 expect(isDocumentQuestion([{revision:1,message_type:'text',body:'賃貸借契約書でも大丈夫ですか'}],false)).toBe(true);
 expect(isDocumentQuestion([],false)).toBe(false);
});
const DOCUMENT_QUESTIONS=[
 '開業届はまだ手元にないのですが、先に掲載申込できますか？',
 '開業届はまだ手元にないのですが、先に掲載申込できますか?',
 '開業届がまだ届かないのですが先に申し込めますか',
 '開業届がまだです',
 '開業届',
 '書類について',
 '必要書類を教えてください',
 'どんな書類が必要ですか',
 '書類はいつ出せばいいですか',
 '書類は後から提出でも可能ですか',
 '書類がなくても申込できますか',
 '営業許可証でも大丈夫ですか',
 '営業許可が下りる前でも登録できますか',
 '検査確認済証で提出できますか',
 '開設届のコピーでもいいですか',
 '賃貸借契約書でも大丈夫ですか',
 '賃貸契約書は使えますか',
 '公共料金の請求書でもいいですか',
 '電気代の領収書で代用できますか',
 '保健所の証明書でも可能ですか',
 '届出がまだですが掲載申込できますか',
 '開業届と営業許可証、どちらを出せばいいですか',
 '保険証券でも大丈夫ですか',
 '出店契約書で提出できますか',
 '本人確認は何が必要ですか',
 '書類の提出方法と必要なものを教えてください',
 '開業届を申請中ですが先に申込できますか',
 '営業許可証の審査中ですが申込できますか',
 '書類が揃っていないのですが',
 '提出書類は何ですか',
 '請求書でも店舗確認できますか',
 '開 業 届はまだですが申込できますか',
 '書類は必要ですか？写真も必要ですか？',
 '契約書しかないのですが申込できますか',
 '確認書類は何を送ればよいですか',
 '開業届を紛失したのですが他のものでもいいですか',
 '開業届はこれから出す予定です。先に掲載の申し込みは可能でしょうか',
 '営業許可証がまだ発行されていません',
 '税務署から開業届の控えが戻っていないのですが',
 '開業届は税務署に提出したばかりで控えがないのですが申込できますか',
 '書類は何点必要ですか',
 '賃貸契約書の写しでもOKですか',
 '店舗の契約書を提出すればいいですか',
 '書類が手元に無いです',
 '必要な書類は？',
 '公共料金の領収書でもよいですか',
 '開業届なしで登録できますか',
 '営業許可証、審査中でまだ手元にないです',
 '開業届を無くしました。掲載できますか',
 '営業許可証のコピーで大丈夫ですか',
 '書類って何を用意すればいい？',
 '賃貸借契約書で代用したいです',
 '開設届がまだ受理されていません',
 '証明書しかありません',
 '開業届の代わりになるものはありますか',
 '書類は登録の時に要りますか',
 '使用契約書でも問題ないですか',
 '営業許可証がなくても掲載できますか',
 'ガスの請求書でもいいでしょうか',
 '店舗の確認に必要なものは書類ですか',
 '税務署に提出した開業届の控えを店舗確認に使えますか？',
 '保健所に提出した開設届の写しでも大丈夫ですか',
 '書類って何を用意すればいい？',
 '開業届の控えしかないです',
 '開業届って必要ですか',
 '書類はどこから出せばいいですか',
 '営業許可証がまだ届いていませんが申込できますか',
 '賃貸契約書のコピーで店舗確認できますか',
 '開設届しか手元にありません',
 'どの書類を出せばいいか分かりません',
 '開業届でいいですか？',
 '営業許可証でよろしいですか？',
];
const OTHER_MATTERS=[
 '掲載料はいくらですか',
 '掲載料の請求書を発行してください',
 '請求書はいつ届きますか',
 '請求書払いはできますか',
 '今月の請求書の金額が違います',
 '領収書を発行してもらえますか',
 '予約の領収書はどこで見られますか',
 'CareLinkとの契約書はありますか',
 '契約書を交わす必要はありますか',
 '利用規約と契約書の違いは何ですか',
 '解約したいのですが契約書は必要ですか',
 '本人確認メールが届きません',
 '本人確認のコードが届かないです',
 'ログインの本人確認ができません',
 '証明書エラーでサイトが開けません',
 'SSL証明書の期限が切れていませんか',
 '書類をアップロードできません',
 '書類のアップロードでエラーになります',
 '開業届の画像がアップロードできない',
 '書類を送信しましたが届いていますか',
 '書類を提出しました',
 '開業届を送りました。確認お願いします',
 '書類の審査はいつ終わりますか',
 '提出した書類の審査状況を教えてください',
 '書類が却下された理由を教えてください',
 '書類は公開後に提出でもいいですか',
 '開業届を出すのは掲載後でも大丈夫ですか',
 '提出した書類を削除してください',
 '書類の個人情報はどう管理されますか',
 '書類のマイナンバーは黒塗りでいいですか',
 '書類のファイル形式はPDFですか',
 '開業届の書き方を教えてください',
 '開業届は税務署のどこに出すのですか',
 '予約のお客様に同意書類を書いてもらう機能はありますか',
 'お客様の問診書類を保存できますか',
 '求人の応募書類はどこで見られますか',
 '退会届出はどうすればいいですか',
 '住所変更の届出はどうすればいいですか',
 '資格の証明書をプロフィールに載せられますか',
 '営業許可証を店舗ページに掲載できますか',
 '予約の変更はできますか',
 '領収書の宛名を変更したい',
 '請求書の送付先を変えたい',
 '契約書のひな形はありますか',
 '本人確認のSMSが来ない',
 '写真のアップロードができません',
 '書類の不備と連絡が来ました',
 '提出した開業届を差し替えたい',
 '証明書の警告が出ます',
 '書類を保管する期間は？',
 '書類が開けません',
 '請求書をメールでも送ってもらえますか',
 '契約書を郵送してください',
 '請求書の支払期限はいつですか',
 '書類のアップロード画面が真っ白です',
 '開業届の記入例はありますか',
 '本人確認が終わりません',
 '営業許可の取り方を教えてください',
 '請求書の宛名はどうなりますか',
 '書類の確認はどのくらいかかりますか',
 '契約期間を教えてください',
 '証明書を印刷したい',
 '口コミの削除をお願いします',
 '領収書が届きません',
 '書類を添付できません。どうすればよいですか？',
 '書類を送信済みですが、届いていますか？',
 '書類届きましたか',
 '開業届を出しました',
 '書類ありがとうございました',
 '営業許可の書類、明日送ります',
 '開業届の提出が完了しました',
 '書類の件、了解です',
 '公開後に開業届を出す形で申込できますか',
 '営業許可証は掲載後に提出でも使えますか',
 '書類の再提出はどうすればいいですか',
 '書類の送り先のメールアドレスは？',
 '書類が文字化けしています',
 '開業届を出したことを報告します',
 '書類を差し替えたいです',
 '書類の返却はできますか',
 '書類のアップロードでエラーになります。代わりにメールで送ってもいいですか？',
 '提出した書類に不備があるようですが、このままでも大丈夫ですか？',
];
// 検査表（PR #970・神原さんの回答 2026-11-22「B：決めた型は必ず定型文＋AI判定」）
const ALWAYS_FIXED=[
 '開業届はまだ手元にないのですが、先に掲載申込できますか？',
 '開業届はまだ手元にないのですが、先に掲載申込できますか?',
 '開 業 届はまだですが申込できますか',
 '開業届がまだ届かないのですが先に申し込めますか',
 '営業許可証がまだ届いていませんが申込できますか',
 '書類がなくても申込できますか',
 '開業届なしで登録できますか',
 '必要書類を教えてください',
 '必要な書類は？',
 '提出書類は何ですか',
 'どんな書類が必要ですか',
 '開業届でいいですか？',
 '営業許可証でよろしいですか？',
 '営業許可証でも大丈夫ですか',
 '営業許可証のコピーで大丈夫ですか',
 '開設届のコピーでもいいですか',
 '賃貸借契約書でも大丈夫ですか',
 '税務署に提出した開業届の控えを店舗確認に使えますか？',
 '保健所に提出した開設届の写しでも大丈夫ですか',
];
const NEVER_FIXED=['書類は公開後に提出でもいいですか','開業届を出すのは掲載後でも大丈夫ですか','公開後に開業届を出す形で申込できますか','営業許可証は掲載後に提出でも使えますか','書類は公開してから出せますか'];
const ask=(body:string,flag:boolean)=>isDocumentQuestion([{revision:1,message_type:'text',body}],flag);
test.each(ALWAYS_FIXED)('a listed form is fixed without the model: %s',body=>{expect(ask(body,false)).toBe(true);expect(ask(body,true)).toBe(true);});
test.each(DOCUMENT_QUESTIONS.filter(body=>!ALWAYS_FIXED.includes(body)))('a document question outside the forms follows the model: %s',body=>{expect(ask(body,false)).toBe(false);expect(ask(body,true)).toBe(true);});
test.each(OTHER_MATTERS.filter(body=>!NEVER_FIXED.includes(body)))('another matter follows the model and is never matched by a form: %s',body=>{expect(ask(body,false)).toBe(false);expect(ask(body,true)).toBe(true);});
test.each(NEVER_FIXED)('submission after publication is never fixed: %s',body=>{expect(ask(body,false)).toBe(false);expect(ask(body,true)).toBe(false);});
test.each(ALWAYS_FIXED.flatMap(body=>['アップロードでエラーになります','もう提出しましたが不備と言われました','掲載料はいくらですか'].flatMap(extra=>[`${body}${extra}`,`${extra}。${body}`])))('a form mixed with another matter follows the model: %s',body=>{expect(ask(body,false)).toBe(false);});
test('a greeting and line breaks do not break a listed form',()=>{expect(ask('こんにちは。\n開業届でいいですか？',false)).toBe(true);});
test.each([
 ['開業届でいいですか？',false,true],['何を出せばいいですか',true,true],['書類を添付できません。どうすればよいですか？',false,false],['書類は公開後に提出でもいいですか',true,false],
] as const)('generation follows the inspection table: %s / %s',async(body,documentList,fixed)=>{
 create.mockResolvedValue({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({text:'個別の返信案です。',missingInformation:[],sourceUrls:[],documentList})}]});
 const result=await generateLineSupportDraft([{revision:1,message_type:'text',body}],facts,conversation);if(result.state!=='ready')throw new Error('not ready');
 expect(result.draft.text).toBe(fixed?LINE_SUPPORT_DOCUMENT_REPLY:'個別の返信案です。');
});
// 話し言葉の検査表（2026-11-22 実機テスト不合格を受け、実装前に確定）
const REPORTED='開業届が手元にないけど、先に申し込みすることって可能ですか？\n\nお手隙の際にご返信のほどお願いします。';
const NATURAL_FORMS=[
 '開業届が手元にないけど、先に申し込みすることって可能ですか？',
 '開業届が手元にないのですが、先に申し込みすることは可能でしょうか',
 '開業届がまだないんですけど、申し込みってできますか？',
 '開業届まだなんだけど先に申し込みできる？',
 '開業届を持ってないんですが申込だけ先にできますか',
 '営業許可証が手元にありませんが、先に掲載申込することはできますか',
 '書類がまだ揃ってないんですけど、先に申し込んでも大丈夫ですか',
 '書類が無くても申込出来ますか',
 '開業届って手元になくても申し込めます？',
 '開業届がまだできていないのですが、先に申し込むことは可能ですか',
 '開業届がない状態でも申し込みはできますか',
 '開業届がまだ届いてないけど先に登録だけってできますか',
 '必要な書類って何ですか？',
 '必要書類って何がありますか',
 'どんな書類がいりますか',
 '書類って何が必要ですか',
 '開業届でもOKですか',
 '開業届で大丈夫そうですか',
 '営業許可証のコピーでもいけますか',
 '開業届がまだないんだけど、先に申込ってできますか',
 'すみません、開業届ってまだ手元にないんですけど申し込みできますか？',
 '開業届が手元にないけど先に掲載の申し込みだけすることはできますか',
 '開業届まだ出してないんですけど申し込めますか',
 '開業届が無いんですが先に申請できますか',
 '営業許可証がまだ届いてなくて、先に申し込みしてもいいですか',
 '開業届なくても申し込みいけます？',
 '書類が揃っていないのですが申し込みは可能ですか。よろしくお願いします',
 '必要な書類を教えて下さい。お手すきの際にご確認お願いします',
 '開業届のコピーでも大丈夫ですか？ご返信お待ちしています',
 '突然のご連絡失礼します。開業届が手元にないけど申し込みできますか',
 '開業届がないと申し込みできませんか',
];
const COURTESY:((question:string)=>string)[]=[
 q=>q,
 q=>`${q}\n\nお手隙の際にご返信のほどお願いします。`,
 q=>`お世話になっております。\n${q}`,
 q=>`こんばんは！${q}\nよろしくお願いいたします。`,
 q=>`お忙しいところ恐れ入りますが、${q}`,
 q=>`はじめまして。夜分遅くに失礼します。${q}\nご確認よろしくお願いします🙇`,
];
const NOT_A_FORM=[
 '開業届が手元にないので申し込みできません',
 '開業届が手元にないけど申し込みしました',
 '開業届がないのに申込が完了しました',
 '書類がなくて申し込み画面でエラーになります',
 '開業届が手元にないけど掲載料はかかりますか',
 '開業届が手元にないけど先に申し込みすることって可能ですか？あと掲載料はいくらですか？',
 '書類のアップロードができないけど申し込みできますか',
 '開業届が手元にないけど予約の申し込みはできますか',
 '開業届が手元にないけど先に公開することって可能ですか',
 '開業届でもいいですか？もう送りましたが不備と言われました。よろしくお願いします。',
 '開業届を送りました。確認お願いします。',
 'お手隙の際にご返信のほどお願いします。',
 'よろしくお願いします。',
 '開業届が手元にないけど申し込みをキャンセルできますか',
 '開業届がまだですが登録の削除はできますか',
 '書類がないのに登録できました',
 '開業届でいいですか。請求書もお願いします',
 '書類を送りました。ご確認お願いします',
 '開業届が手元にないけど申し込み内容の変更はできますか',
 '営業許可証がないけど予約の登録はできますか',
 '必要な書類を教えてください。あと解約方法も',
 '開業届がまだなのでメール登録できません',
 'お忙しいところ恐れ入りますが、審査状況を教えてください',
 '開業届がなくても掲載できますか',
];
const NATURAL_DEFERRAL=[
 '開業届が手元にないけど、公開した後に出す形で先に申し込みすることって可能ですか？',
 '開業届がないので掲載してから出してもいいですか？よろしくお願いします。',
 '書類は公開してからでも申し込みできますか',
];
test('the consultation from the failed device test gets the fixed reply even when the model says false',async()=>{
 create.mockResolvedValue({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({text:'個別の返信案です。',missingInformation:[],sourceUrls:[],documentList:false})}]});
 const result=await generateLineSupportDraft([{revision:1,message_type:'text',body:REPORTED}],facts,conversation);if(result.state!=='ready')throw new Error('not ready');
 expect(result.draft.text).toBe(LINE_SUPPORT_DOCUMENT_REPLY);
});
test.each([...NATURAL_FORMS,...ALWAYS_FIXED].flatMap(question=>COURTESY.map(wrap=>wrap(question))))('natural wording is fixed without the model: %s',body=>{expect(ask(body,false)).toBe(true);});
test.each(NOT_A_FORM.flatMap(question=>COURTESY.map(wrap=>wrap(question))))('natural wording with another meaning is not a form: %s',body=>{expect(ask(body,false)).toBe(false);});
test.each(NATURAL_DEFERRAL.flatMap(question=>COURTESY.map(wrap=>wrap(question))))('natural wording cannot obtain a deferral: %s',body=>{expect(ask(body,false)).toBe(false);expect(ask(body,true)).toBe(false);});
test('the fixed document reply keeps one marker per level and a closing sentence',()=>{
 const lines=LINE_SUPPORT_DOCUMENT_REPLY.split('\n');
 expect(LINE_SUPPORT_DOCUMENT_REPLY).not.toContain('・');expect(LINE_SUPPORT_DOCUMENT_REPLY).not.toContain('公官庁');
 expect(lines.filter(l=>l.startsWith('【'))).toEqual(['【今後の流れ】','【提出できる書類の例】']);
 expect(lines.filter(l=>l.startsWith('● '))).toHaveLength(6);
 expect(lines.at(-1)).toContain('ご提出いただけます');expect(LINE_SUPPORT_DOCUMENT_REPLY).not.toMatch(/\n{3,}/);
});
test('the newest message is the question even when history arrives out of order',()=>{
 expect(splitConsultation([{revision:2,message_type:'text',body:'b'},{revision:1,message_type:'text',body:'a'}])).toEqual({question:{revision:2,message_type:'text',body:'b'},earlierMessages:[{revision:1,message_type:'text',body:'a'}]});
 expect(splitConsultation([])).toEqual({question:null,earlierMessages:[]});
});
test('a draft containing only decoration is rejected after plain text formatting',async()=>{
 create.mockResolvedValue({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({text:' ** ** ',missingInformation:[],sourceUrls:[],documentList:false})}]});
 expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('unavailable');
});
test('existing provider aliases are supported without switching providers',async()=>{
 delete process.env.ANTHROPIC_API_KEY;delete process.env.LINE_SUPPORT_CLAUDE_MODEL;
 process.env.CLAUDE_API_KEY='synthetic-alias';process.env.CLAUDE_MODEL='alias-model';
 expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('ready');
});
test.each(['key','model','quota','provenance'])('missing %s never calls a paid model',async part=>{
 if(part==='key'){delete process.env.ANTHROPIC_API_KEY;delete process.env.CLAUDE_API_KEY;}
 if(part==='model'){delete process.env.LINE_SUPPORT_CLAUDE_MODEL;delete process.env.CLAUDE_MODEL;}
 if(part==='quota')(chatDailyLimit as jest.Mock).mockReturnValue(null);
 expect((await generateLineSupportDraft(history,part==='provenance'?lineSupportKnowledge(null):facts,conversation)).state).toBe('unavailable');
 expect(create).not.toHaveBeenCalled();
});
test.each(['limited','unavailable'])('quota %s blocks generation',async state=>{
 (checkChatLimit as jest.Mock).mockResolvedValue(state);expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('unavailable');expect(create).not.toHaveBeenCalled();
});
test.each([{stop_reason:'max_tokens',content:[]},{stop_reason:'end_turn',content:[{type:'text',text:'bad json'}]},
 {stop_reason:'end_turn',content:[{type:'text',text:'{"text":{},"missingInformation":[],"sourceUrls":[],"documentList":false}'}]}])('does not accept incomplete or malformed model output %j',async value=>{
 create.mockResolvedValue(value);expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('unavailable');
});
test('provider errors do not log customer details or credentials',async()=>{
 create.mockRejectedValue(new Error('synthetic provider failure'));const spy=jest.spyOn(console,'error').mockImplementation();
 expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('unavailable');expect(spy).not.toHaveBeenCalled();spy.mockRestore();
});
test('context sent to the model masks incidental contacts and credentials',()=>{
 const text='a@example.com 090-1234-5678 U'+'1'.repeat(32)+' sk-abcdefghijklmnop';
 const result=minimiseSupportContext([{revision:1,message_type:'text',body:text}])[0].body;
 expect(result).not.toContain('example.com');expect(result).not.toContain('090-1234-5678');expect(result).not.toContain('1'.repeat(32));expect(result).not.toContain('abcdefghijklmnop');
 expect(history[0].body).toBe('ログインできません。');
});
test.each([{release:'local',conversation},{release:'a'.repeat(40),conversation:'not-a-case'}])('invalid provenance or conversation cannot consume the model budget: %j',async input=>{
 expect((await generateLineSupportDraft(history,lineSupportKnowledge(input.release),input.conversation)).state).toBe('unavailable');expect(checkChatLimit).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
});
test('one conversation cannot consume more than its own daily allowance',async()=>{
 (checkChatLimit as jest.Mock).mockResolvedValueOnce('limited');
 expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('unavailable');
 expect(checkChatLimit).toHaveBeenCalledTimes(1);expect(checkChatLimit).toHaveBeenCalledWith('chat-daily:line-support:'+conversation,10,86400000);expect(create).not.toHaveBeenCalled();
});
test('the existing global AI allowance still applies after the per-conversation fence',async()=>{
 (checkChatLimit as jest.Mock).mockResolvedValueOnce('allowed').mockResolvedValueOnce('limited');
 expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('unavailable');expect(checkChatLimit).toHaveBeenLastCalledWith('chat-daily:global',10,86400000);expect(create).not.toHaveBeenCalled();
});

test('a dedicated support key takes precedence over the common AI credential',async()=>{
 process.env.CLAUDE_API_KEY='synthetic-support-only';expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('ready');expect(Anthropic).toHaveBeenCalledWith(expect.objectContaining({apiKey:'synthetic-support-only'}));
});

test('requests provider-enforced JSON while retaining the local strict source and length validator',async()=>{
 expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('ready');
 const format=create.mock.calls[0][0].output_config.format;
 expect(format.type).toBe('json_schema');expect(format.schema.additionalProperties).toBe(false);
 expect(format.schema.required).toEqual(['text','missingInformation','sourceUrls','documentList']);
 // This installed SDK moves unsupported constraints into descriptions; the local parser remains authoritative.
 for(const url of facts.facts.sources)expect(JSON.stringify(format.schema)).toContain(url);
 expect(format.parse(JSON.stringify({text:'案',missingInformation:[],sourceUrls:[],documentList:false}))).toEqual({text:'案',missingInformation:[],sourceUrls:[],documentList:false});
 expect(()=>format.parse(JSON.stringify({text:'案',missingInformation:[],sourceUrls:['https://evil.invalid'],documentList:false}))).toThrow();
});
test.each([
 ['incomplete_response',{stop_reason:'max_tokens',content:[]}],
 ['invalid_json',{stop_reason:'end_turn',content:[{type:'text',text:'private malformed response'}]}],
 ['invalid_schema',{stop_reason:'end_turn',content:[{type:'text',text:'{"text":"案","missingInformation":[],"sourceUrls":["https://evil.invalid"],"documentList":false}'}]}],
] as const)('only a fixed failure code is logged for %s',async(reason,response)=>{
 const spy=jest.spyOn(console,'warn').mockImplementation();create.mockResolvedValue(response);
 try{expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('unavailable');expect(spy).toHaveBeenCalledWith('[line-support-draft]',reason);expect(JSON.stringify(spy.mock.calls)).not.toContain('private');expect(JSON.stringify(spy.mock.calls)).not.toContain('evil.invalid');}finally{spy.mockRestore();}
});
