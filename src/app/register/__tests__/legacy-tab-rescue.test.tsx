/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Blob as NodeBlob } from 'node:buffer';
import { createHash, webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';
import { readFileSync } from 'node:fs';
import LegacyRegisterForm from '../../../../e2e/fixtures/legacy-register-form';
import { importSalonDraftBackup } from '../../../lib/salon-draft-backup';
import { createLegacySalonTabRescue } from '../../../../scripts/salon-legacy-tab-rescue.mjs';
const mockUpload = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/components/MultiPhotoUpload', () => require('../../../../e2e/fixtures/legacy-multi-photo-upload'));
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: jest.fn() }));
jest.mock('@/lib/image-compress', () => ({ compressImage: jest.fn(async (file: File) => file) }));
jest.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({ upload: mockUpload }) } } }));
const oldBlob = global.Blob, oldCrypto = global.crypto;
beforeAll(() => {
 Object.defineProperty(global, 'crypto', { configurable: true, value: webcrypto });
 Object.assign(global, { Blob: NodeBlob, TextEncoder, TextDecoder });
 Object.defineProperty(File.prototype, 'arrayBuffer', { configurable: true, value: function () {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result);
   reader.onerror = reject; reader.readAsArrayBuffer(this); });
 } });
});
afterAll(() => { global.Blob = oldBlob; Object.defineProperty(global, 'crypto', { configurable: true, value: oldCrypto }); });
beforeEach(() => { sessionStorage.clear(); jest.clearAllMocks(); global.fetch = jest.fn(() => { throw Error('Network forbidden'); }); });
async function filledOldForm() {
 render(<LegacyRegisterForm v2Enabled={false} />);
 await waitFor(() => expect(screen.getByLabelText(/^施設名/)).toBeEnabled());
 for (const [name, value] of [['facility_name',' 合成旧タブ '],['business_type','ヘアサロン'],['representative_name','合成代表'],
  ['contact_name','合成担当'],['email','rescue@example.invalid'],['phone','09012345678'],['contact_phone','08012345678'],['website','https://example.invalid']]) {
  fireEvent.change(document.querySelector(`[name="${name}"]`)!, { target: { value } });
 }
 fireEvent.click(screen.getByRole('button', { name: '次へ' }));
 await screen.findByLabelText(/^郵便番号/);
 for (const [name,value] of [['address','愛知県西尾市合成町1'],['building_name','合成建物'],['nearest_station','合成駅'],
  ['business_hours','10:00〜19:00'],['regular_holiday','火曜'],['seat_count','0'],['staff_count','2']]) {
  fireEvent.change(document.querySelector(`[name="${name}"]`)!, { target: { value } });
 }
 fireEvent.click(document.querySelector('[name="has_parking"]')!);
 const feature = document.querySelector('[data-field="features"] button')!;
 fireEvent.click(feature);
 const featureName = feature.textContent!.replace(/^✓\s*/, '').trim();
 fireEvent.click(screen.getByRole('button', { name: '次へ' }));
 await screen.findByRole('button', { name: '登録する' });
 fireEvent.change(screen.getByLabelText(/^PR文/), { target: { value: '合成原入力' } });
 const bytes = new Uint8Array([0, 1, 2, 250, 255]);
 fireEvent.change(screen.getByLabelText('外観の写真を選択'), { target: { files: [new File([bytes], 'original.png', { type:'image/png' })] } });
 await waitFor(() => expect(screen.getByAltText('外観')).toHaveAttribute('src','data:image/png;base64,AAEC+v8='));
 return { bytes, featureName };
}
test('capture exact old UI backwards, preserve all entered fields and original photo bytes, import without any network or submit', async () => {
 const { bytes, featureName } = await filledOldForm();
 const rescue = createLegacySalonTabRescue(document);
 expect(rescue.capture()).toMatchObject({ capturedScreens:[3], photoCount:1, missingScreens:[1,2] });
 await expect(rescue.buildBackup({ unsentConfirmed:true, confirmedPhotoCount:1 })).rejects.toThrow('3画面');
 fireEvent.click(screen.getByRole('button',{name:'戻る'})); await screen.findByLabelText(/^郵便番号/);
 rescue.capture(); fireEvent.click(screen.getByRole('button',{name:'戻る'})); await screen.findByLabelText(/^施設名/);
 expect(rescue.capture().missingScreens).toEqual([]);
 await expect(rescue.buildBackup({ confirmedPhotoCount:1 })).rejects.toThrow('未送信');
 await expect(rescue.buildBackup({ unsentConfirmed:true, confirmedPhotoCount:0 })).rejects.toThrow('写真枚数');
 const blob = await rescue.buildBackup({ unsentConfirmed:true, confirmedPhotoCount:1 });
 const restored = await importSalonDraftBackup(blob);
 expect(restored.values).toMatchObject({facility_name:' 合成旧タブ ',email:'rescue@example.invalid',contact_phone:'080-1234-5678',
  website:'https://example.invalid',address:'愛知県西尾市合成町1',building_name:'合成建物',nearest_station:'合成駅',
  business_hours:'10:00〜19:00',regular_holiday:'火曜',seat_count:0,staff_count:2,has_parking:true,features:[featureName],pr_text:'合成原入力'});
 expect(restored.photos.slice(1)).toEqual(Array(6).fill(null));
 expect(Buffer.from(await restored.photos[0]!.arrayBuffer())).toEqual(Buffer.from(bytes));
 expect(restored.photos[0]!.name).toBe('recovered-slot-1.png'); expect(restored.photos[0]!.lastModified).toBe(0);
 expect(global.fetch).not.toHaveBeenCalled(); expect(mockUpload).not.toHaveBeenCalled();
});
test('block unsupported, pending, unknown and remote-photo screens without changing captured state', async () => {
 const { bytes } = await filledOldForm(); const rescue = createLegacySalonTabRescue(document);
 rescue.capture();
 const image = screen.getByAltText('外観'); image.setAttribute('src','https://example.invalid/not-original.png');
 expect(() => rescue.capture()).toThrow('遠隔画像'); image.setAttribute('src','data:image/png;base64,AAEC+v8=');
 const fieldset = document.querySelector('fieldset')!; fieldset.disabled = true;
 expect(() => rescue.capture()).toThrow('結果不明');
 await expect(rescue.buildBackup({unsentConfirmed:true,confirmedPhotoCount:1})).rejects.toThrow('結果不明');
 fieldset.disabled = false;
 const dialog = document.createElement('div'); dialog.setAttribute('role','dialog'); document.body.append(dialog);
 expect(() => rescue.capture()).toThrow('確認ダイアログ'); dialog.remove();
 expect(rescue.capture()).toMatchObject({photoCount:1});
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(createHash('sha256').update(Buffer.from('AAEC+v8=','base64')).digest('hex'));
 expect(global.fetch).not.toHaveBeenCalled();
});
test('fixture is the actual old MultiPhotoUpload rather than current recovery-aware component',()=>{
 expect(createHash('sha256').update(readFileSync('e2e/fixtures/legacy-multi-photo-upload.tsx')).digest('hex')).toBe('b1e9c197f69a3ad0b5fdb3f99f5f26dea711a110fda0e314f2cd6d07e33c0f0f');
});

test('editing a captured screen invalidates it and hash-time changes abort instead of exporting stale values', async () => {
 await filledOldForm(); const rescue = createLegacySalonTabRescue(document); rescue.capture();
 fireEvent.click(screen.getByRole('button',{name:'戻る'})); await screen.findByLabelText(/^郵便番号/); rescue.capture();
 fireEvent.click(screen.getByRole('button',{name:'戻る'})); await screen.findByLabelText(/^施設名/); rescue.capture();
 fireEvent.change(screen.getByLabelText(/^施設名/), {target:{value:'編集済み'}});
 await expect(rescue.buildBackup({unsentConfirmed:true,confirmedPhotoCount:1})).rejects.toThrow('3画面');
 rescue.capture();
 const reader = rescue.buildBackup({unsentConfirmed:true,confirmedPhotoCount:1});
 // Real DOM value change without an event must also be caught after async hash.
 (document.querySelector('[name="facility_name"]') as HTMLInputElement).value = '計算中変更';
 await expect(reader).rejects.toThrow('画面が回収時');
 rescue.dispose(); expect(()=>rescue.capture()).toThrow('対応していない');
});
