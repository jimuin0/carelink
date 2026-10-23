'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { formatMegabytes } from '@/lib/format-megabytes';

export interface PhotoSlot {
  label: string;
  required?: boolean;
}

interface MultiPhotoUploadProps {
  slots: PhotoSlot[];
  onChange: (files: (File | null)[]) => void;
  initialFiles?: readonly (File | null)[];
  /**
   * 送信前に端末で縮小している場合はそれを渡す。上限を超える写真は、選んだ時点で縮小して
   * 上限内に収まればその縮小版を採用する（スマホの写真は 10MB を超えやすく、縮小後なら
   * 十分小さいのに「選べない」と拒否していた）。渡さなければ元のサイズで判定する。
   */
  compress?: (file: File) => Promise<File>;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export default function MultiPhotoUpload({ slots, onChange, initialFiles, compress }: MultiPhotoUploadProps) {
  const [previews, setPreviews] = useState<(string | null)[]>(slots.map(() => null));
  const files = useRef<(File | null)[]>(slots.map((_, index) => initialFiles?.[index] ?? null));
  const generations = useRef<number[]>(slots.map(() => 0));
  const [errors, setErrors] = useState<(string | null)[]>(slots.map(() => null));
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Restoration remounts this component with verified originals. Reading a
    // preview never replaces or recompresses those source files.
    files.current.forEach((file, index) => {
      if (!file) return;
      const generation = ++generations.current[index];
      const reader = new FileReader();
      reader.onload = () => {
        if (generations.current[index] !== generation) return;
        setPreviews(current => current.map((value, i) => i === index ? reader.result as string : value));
      };
      const fail = () => {
        if (generations.current[index] !== generation) return;
        setErrors(current => current.map((value, i) => i === index ? '写真のプレビューを読み込めませんでした。元の写真は保持されています。' : value));
      };
      reader.onerror = fail;
      try { reader.readAsDataURL(file); } catch { fail(); }
    });
    return () => { generations.current = generations.current.map(value => value + 1); };
  }, []);

  const changeFile = (index: number, file: File | null) => {
    files.current = files.current.map((current, i) => i === index ? file : current);
    onChange([...files.current]);
  };
  const changeError = (index: number, message: string | null) => {
    setErrors(current => current.map((value, i) => i === index ? message : value));
  };
  const clearPreview = (index: number) => {
    setPreviews(current => current.map((value, i) => i === index ? null : value));
  };

  const showPreview = (index: number, file: File, generation: number) => {
    changeFile(index, file);
    clearPreview(index);
    const reader = new FileReader();
    reader.onload = () => {
      if (generations.current[index] !== generation) return;
      setPreviews(current => current.map((value, i) => i === index ? reader.result as string : value));
    };
    const fail = () => {
      if (generations.current[index] !== generation) return;
      changeFile(index, null);
      changeError(index, '写真を読み込めませんでした。別の写真を選択してください');
    };
    reader.onerror = fail;
    try { reader.readAsDataURL(file); } catch { fail(); }
  };

  const acceptFile = (index: number, file: File | null) => {
    const generation = ++generations.current[index];
    changeError(index, null);

    if (!file) {
      clearPreview(index);
      changeFile(index, null);
      return;
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      changeFile(index, null);
      clearPreview(index);
      changeError(index, 'JPG、PNG、WEBP、GIF形式のみ');
      return;
    }

    if (file.size > MAX_SIZE) {
      changeFile(index, null);
      clearPreview(index);
      const tooLarge = `${formatMegabytes(MAX_SIZE)}以下にしてください（選択した写真：${formatMegabytes(file.size)}）`;
      if (!compress) { changeError(index, tooLarge); return; }
      // 送信時と同じ縮小をここで先に行い、縮小後の大きさで判定する。
      void compress(file).then(
        (smaller) => {
          if (generations.current[index] !== generation) return;
          if (smaller.size > MAX_SIZE || !ACCEPTED_TYPES.includes(smaller.type)) { changeError(index, tooLarge); return; }
          showPreview(index, smaller, generation);
        },
        () => {
          if (generations.current[index] !== generation) return;
          changeError(index, tooLarge);
        },
      );
      return;
    }

    showPreview(index, file, generation);
  };

  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    acceptFile(index, e.target.files?.[0] ?? null);
  };

  // まとめて選んだ写真は、空いている枠へ上から順に入れる（既に選んだ写真は置き換えない）。
  const handleBulkChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (chosen.length === 0) return;
    const empty = files.current.map((file, index) => file ? -1 : index).filter(index => index >= 0);
    chosen.slice(0, empty.length).forEach((file, i) => acceptFile(empty[i], file));
    const skipped = chosen.length - Math.min(chosen.length, empty.length);
    setBulkMessage(skipped > 0
      ? `空いている枠が足りないため、${skipped}枚は追加していません。不要な写真を削除してから追加してください。`
      : null);
  };

  const handleRemove = (index: number) => {
    ++generations.current[index];
    clearPreview(index);
    changeFile(index, null);
    changeError(index, null);
    const input = inputRefs.current[index];
    if (input) input.value = '';
  };

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {slots.map((slot, i) => (
          <div key={slot.label}>
            <p className="text-xs text-gray-600 mb-1">
              {slot.label}
              {slot.required && <span className="text-red-600 ml-0.5">*</span>}
            </p>
            {previews[i] ? (
              <div className="relative">
                <Image
                  src={previews[i]!}
                  alt={slot.label}
                  width={160}
                  height={120}
                  className="w-full aspect-4/3 object-cover rounded-lg border"
                  unoptimized
                />
                <button
                  type="button"
                  onClick={() => handleRemove(i)}
                  aria-label={`${slot.label}の写真を削除`}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-700 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-800 before:absolute before:-inset-2.5 before:content-['']"
                >
                  ×
                </button>
              </div>
            ) : (
              // 入力欄は sr-only（display:none だとキーボードで到達できない）。フォーカスは
              // 見えない入力欄に入るので、枠側に focus-within でリングを出す。
              <label className="flex flex-col items-center justify-center w-full aspect-4/3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-(--primary) transition-colors bg-gray-50 focus-within:border-(--primary) focus-within:ring-2 focus-within:ring-(--primary) focus-within:ring-offset-2">
                <svg className="w-6 h-6 text-gray-600 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-xs text-gray-600" aria-hidden="true">写真を選択</span>
                <input
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="file"
                  aria-label={`${slot.label}の写真を選択`}
                  accept=".jpg,.jpeg,.png,.webp,.gif"
                  onChange={(e) => handleChange(i, e)}
                  className="sr-only"
                />
              </label>
            )}
            {errors[i] && <p className="form-error text-xs mt-1" role="alert">{errors[i]}</p>}
          </div>
        ))}
      </div>
      <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-(--primary) px-4 text-sm font-medium text-(--primary) focus-within:ring-2 focus-within:ring-(--primary) focus-within:ring-offset-2">
        写真をまとめて選ぶ
        <input
          type="file"
          multiple
          aria-label="写真をまとめて選ぶ（空いている枠へ順に追加）"
          accept=".jpg,.jpeg,.png,.webp,.gif"
          onChange={handleBulkChange}
          className="sr-only"
        />
      </label>
      {bulkMessage && <p className="form-error mt-2" role="status">{bulkMessage}</p>}
    </div>
  );
}
