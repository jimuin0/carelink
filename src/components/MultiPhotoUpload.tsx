'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';

export interface PhotoSlot {
  label: string;
  required?: boolean;
}

interface MultiPhotoUploadProps {
  slots: PhotoSlot[];
  onChange: (files: (File | null)[]) => void;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export default function MultiPhotoUpload({ slots, onChange }: MultiPhotoUploadProps) {
  const [previews, setPreviews] = useState<(string | null)[]>(slots.map(() => null));
  const files = useRef<(File | null)[]>(slots.map(() => null));
  const generations = useRef<number[]>(slots.map(() => 0));
  const [errors, setErrors] = useState<(string | null)[]>(slots.map(() => null));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => () => {
    generations.current = generations.current.map(value => value + 1);
  }, []);

  const changeFile = (index: number, file: File | null) => {
    files.current = files.current.map((current, i) => i === index ? file : current);
    onChange([...files.current]);
  };
  const changeError = (index: number, message: string | null) => {
    setErrors(current => current.map((value, i) => i === index ? message : value));
  };

  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const generation = ++generations.current[index];
    changeError(index, null);

    if (!file) {
      setPreviews(current => current.map((value, i) => i === index ? null : value));
      changeFile(index, null);
      return;
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      changeFile(index, null);
      setPreviews(current => current.map((value, i) => i === index ? null : value));
      changeError(index, 'JPG、PNG、WEBP、GIF形式のみ');
      return;
    }

    if (file.size > MAX_SIZE) {
      changeFile(index, null);
      setPreviews(current => current.map((value, i) => i === index ? null : value));
      changeError(index, '10MB以下にしてください');
      return;
    }

    changeFile(index, file);
    setPreviews(current => current.map((value, i) => i === index ? null : value));
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

  const handleRemove = (index: number) => {
    ++generations.current[index];
    setPreviews(current => current.map((value, i) => i === index ? null : value));
    changeFile(index, null);
    changeError(index, null);
    const input = inputRefs.current[index];
    if (input) input.value = '';
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {slots.map((slot, i) => (
        <div key={slot.label}>
          <p className="text-xs text-gray-500 mb-1">
            {slot.label}
            {slot.required && <span className="text-red-500 ml-0.5">*</span>}
          </p>
          {previews[i] ? (
            <div className="relative">
              <Image
                src={previews[i]!}
                alt={slot.label}
                width={160}
                height={120}
                className="w-full aspect-[4/3] object-cover rounded-lg border"
                unoptimized
              />
              <button
                type="button"
                onClick={() => handleRemove(i)}
                aria-label={`${slot.label}の写真を削除`}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600 before:absolute before:-inset-2.5 before:content-['']"
              >
                ×
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center w-full aspect-[4/3] border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-sky-400 transition-colors bg-gray-50">
              <svg className="w-6 h-6 text-gray-400 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-xs text-gray-400">写真を選択</span>
              <input
                ref={(el) => { inputRefs.current[i] = el; }}
                type="file"
                aria-label={`${slot.label}の写真を選択`}
                accept=".jpg,.jpeg,.png,.webp,.gif"
                onChange={(e) => handleChange(i, e)}
                className="hidden"
              />
            </label>
          )}
          {errors[i] && <p className="form-error text-xs mt-1" role="alert">{errors[i]}</p>}
        </div>
      ))}
    </div>
  );
}
