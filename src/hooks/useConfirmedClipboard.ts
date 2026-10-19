'use client';

import { useEffect, useRef, useState } from 'react';

type Status = 'idle' | 'copying' | 'copied' | 'failed';

/** Identity scopes the acknowledgement, not the clipboard contents. Callers
 * copying secrets must use a non-secret record ID. Copied text is never stored in hook state, refs or storage. */
export function useConfirmedClipboard(identity: string | null) {
  const [result, setResult] = useState<{ identity: string | null; status: Status }>({ identity: null, status: 'idle' });
  const mounted = useRef(false);
  const writing = useRef(false);
  const operation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    const operationRef = operation;
    const timerRef = timer;
    return () => {
      mounted.current = false;
      operationRef.current++;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = async (text: string) => {
    if (!mounted.current || identity === null || writing.current) return;
    writing.current = true;
    const current = ++operation.current;
    if (timer.current !== null) clearTimeout(timer.current);
    setResult({ identity, status: 'copying' });
    try {
      await navigator.clipboard.writeText(text);
      if (mounted.current && operation.current === current) {
        setResult({ identity, status: 'copied' });
        timer.current = setTimeout(() => {
          if (mounted.current && operation.current === current) setResult({ identity, status: 'idle' });
        }, 2000);
      }
    } catch {
      if (mounted.current && operation.current === current) setResult({ identity, status: 'failed' });
    } finally {
      writing.current = false;
    }
  };

  return { copy, status: result.identity === identity ? result.status : 'idle', copying: result.status === 'copying' };
}
