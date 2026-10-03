/** Manual, local-only rescue for the fixed old RegisterForm DOM contract.
 * No React internals, storage, network, submit, reload or consent manipulation.
 * Invoke capture on each existing screen; originals come from FileReader previews.
 */
export function createLegacySalonTabRescue(doc) {
  const groups = [
    ['facility_name', 'business_type', 'representative_name', 'contact_name', 'email', 'phone', 'contact_phone', 'website'],
    ['postal_code', 'address', 'building_name', 'nearest_station', 'business_hours', 'regular_holiday', 'seat_count', 'staff_count'],
    ['pr_text', 'desired_start_date'],
  ];
  const labels = ['外観', '内観 1', '内観 2', '内観 3', 'メニュー 1', 'メニュー 2', 'メニュー 3'];
  const mimeExtensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const values = { prefecture: null, city: null };
  const seen = new Set();
  let photos = Array(7).fill(null), revision = 0, disposed = false;
  const fail = message => { throw new Error(message); };
  const form = () => {
    const current = doc.getElementById('reg-pr-text')?.closest('form');
    if (disposed || !current || current.querySelector('fieldset')?.disabled || doc.querySelector('[role="dialog"]')
      || [...current.querySelectorAll('button')].some(button => /送信中/.test(button.textContent))) {
      fail('送信中・結果不明・確認ダイアログ中、または対応していない画面では回収できません。');
    }
    return current;
  };
  const readScreen = () => {
    const current = form(), next = {}, captured = [];
    groups.forEach((fields, index) => {
      if (!fields.some(name => current.querySelector(`[name="${name}"]`))) return;
      fields.forEach(name => {
        const controls = current.querySelectorAll(`[name="${name}"]`);
        if (controls.length !== 1) fail('入力欄の構成が異なります。回収を停止しました。');
        const value = controls[0].value;
        if (name === 'seat_count' || name === 'staff_count') {
          const parsed = value === '' ? null : Number(value);
          if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > 9999)) fail('人数・席数を確認してください。');
          next[name] = parsed;
        } else next[name] = value;
      });
      if (index === 1) {
        const parking = current.querySelector('[name="has_parking"]');
        const features = current.querySelector('[data-field="features"]');
        if (!parking || !features) fail('詳細入力欄の構成が異なります。');
        next.has_parking = parking.checked;
        next.features = [...features.querySelectorAll('button[aria-pressed="true"]')]
          .map(button => button.textContent.trim().replace(/^✓\s*/, ''));
      }
      if (!current.querySelector(`[name="${fields[0]}"]`).closest('[hidden]')) captured.push(index);
    });
    const nextPhotos = labels.map(label => {
      const images = [...current.querySelectorAll('img')].filter(img => img.alt === label);
      const input = current.querySelector(`input[aria-label="${label}の写真を選択"]`);
      if (images.length > 1 || (input?.files?.length && !images.length)) fail('写真の読み込み完了を待ち、表示を確認してください。');
      if (!images.length) return null;
      const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(images[0].getAttribute('src') || '');
      if (!match || match[2].length > Math.ceil(10 * 1024 * 1024 / 3) * 4) fail('元画像のプレビューではありません。遠隔画像は取得しません。');
      const binary = atob(match[2]);
      if (!binary.length || binary.length > 10 * 1024 * 1024 || btoa(binary) !== match[2]) fail('画像のサイズ・形式を確認してください。');
      return { type: match[1], base64: match[2], size: binary.length };
    });
    return { next, captured, nextPhotos };
  };
  const capture = () => {
    const { next, captured, nextPhotos } = readScreen();
    Object.assign(values, next); captured.forEach(index => seen.add(index)); photos = nextPhotos; revision++;
    return { capturedScreens: [...seen].map(index => index + 1), photoCount: photos.filter(Boolean).length,
      missingScreens: [0, 1, 2].filter(index => !seen.has(index)).map(index => index + 1) };
  };
  const changed = event => {
    const target = event.target;
    if (target?.closest?.('form') !== doc.getElementById('reg-pr-text')?.closest('form')) return;
    let group = groups.findIndex(fields => fields.includes(target.name));
    if (target.name === 'has_parking' || target.closest('[data-field="features"]')) group = 1;
    if (target.type === 'file' || target.closest('button[aria-label$="の写真を削除"]')) group = 2;
    if (group >= 0) { seen.delete(group); revision++; }
  };
  for (const type of ['input', 'change', 'click']) doc.addEventListener(type, changed, true);
  const assertCurrent = () => {
    const { next, nextPhotos } = readScreen();
    if (Object.entries(next).some(([name, value]) => JSON.stringify(value) !== JSON.stringify(values[name]))
      || nextPhotos.some((photo, slot) => JSON.stringify(photo) !== JSON.stringify(photos[slot]))) {
      fail('画面が回収時から変わりました。変更した画面をもう一度回収してください。');
    }
  };
  const dispose = () => {
    for (const type of ['input', 'change', 'click']) doc.removeEventListener(type, changed, true);
    Object.keys(values).forEach(name => delete values[name]); seen.clear(); photos = Array(7).fill(null);
    revision++; disposed = true;
  };
  const digest = async bytes => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  const buildBackup = async ({ unsentConfirmed, confirmedPhotoCount } = {}) => {
    form();
    if (unsentConfirmed !== true || seen.size !== 3 || confirmedPhotoCount !== photos.filter(Boolean).length) {
      fail('3画面の回収、写真枚数、未送信の確認が必要です。送信結果不明なら再開せず受付を確認してください。');
    }
    assertCurrent();
    const capturedRevision = revision, copiedValues = JSON.parse(JSON.stringify(values));
    const saved = await Promise.all(photos.map(async (photo, slot) => {
      if (!photo) return null;
      const bytes = Uint8Array.from(atob(photo.base64), character => character.charCodeAt(0));
      // Original bytes/type/order preserved. Filename/time were not in the old
      // preview DOM and are explicitly synthesized rather than claimed original.
      return { name: `recovered-slot-${slot + 1}.${mimeExtensions[photo.type]}`, type: photo.type,
        size: photo.size, lastModified: 0, base64: photo.base64, sha256: await digest(bytes) };
    }));
    const payload = { values: copiedValues, photos: saved };
    const sha256 = await digest(new TextEncoder().encode(JSON.stringify(payload)));
    assertCurrent();
    if (capturedRevision !== revision) fail('回収内容が変わったため保存を中止しました。');
    return new Blob([JSON.stringify({ format: 'carelink-local-draft', version: 1, payload, sha256 })], { type: 'application/json' });
  };
  return Object.freeze({ capture, buildBackup, dispose });
}
