'use client';

import { useState, useRef } from 'react';

interface PhotoUploadProps {
  onChange: (file: File | null) => void;
  error?: string;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export default function PhotoUpload({ onChange, error }: PhotoUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFileError(null);

    if (!file) {
      setPreview(null);
      onChange(null);
      return;
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setFileError('JPG、PNG、WEBP、GIF形式のファイルを選択してください');
      return;
    }

    if (file.size > MAX_SIZE) {
      setFileError('10MB以下のファイルを選択してください');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
    onChange(file);
  };

  const handleRemove = () => {
    setPreview(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div>
      {preview ? (
        <div className="relative inline-block">
          <img src={preview} alt="プレビュー" className="w-32 h-32 object-cover rounded-lg border" />
          <button
            type="button"
            onClick={handleRemove}
            className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600"
          >
            ×
          </button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary transition-colors">
          <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-sm text-gray-500">クリックして写真を選択</span>
          <span className="text-xs text-gray-400 mt-1">JPG, PNG, WEBP, GIF（10MB以下）</span>
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.gif"
            onChange={handleChange}
            className="hidden"
          />
        </label>
      )}
      {(fileError || error) && <p className="form-error">{fileError || error}</p>}
    </div>
  );
}
