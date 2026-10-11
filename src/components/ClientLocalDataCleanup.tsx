'use client';

import { useEffect, useRef, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { clearAccountLocalData, LOCAL_DATA_CLEAR_FAILED } from '@/lib/client-storage';
import { completeClientCleanupMarker, hasClientCleanupNeeded, markClientCleanupNeeded } from '@/lib/client-cleanup-marker';

/** An already-open old logout/retirement UI can leave the non-secret fence.
 * The current app verifies deletion at boot before reopening local drafts. */
export default function ClientLocalDataCleanup() {
  const mounted = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);

  async function clean(mark = false) {
    if (mark) {
      try { markClientCleanupNeeded(); }
      catch { if (mounted.current) setNotice(true); }
    }
    // A dropped cookie write retains the in-memory fence. Still attempt the
    // verified wipe so an unavailable cookie store does not retain more input.
    if (!hasClientCleanupNeeded() || pending.current) return;
    if (mounted.current) { setNotice(true); setBusy(true); }
    const job = Promise.resolve().then(async () => {
      try {
        await clearAccountLocalData();
        completeClientCleanupMarker();
        if (mounted.current) setNotice(false);
      } catch { if (mounted.current) setNotice(true); }
      finally { pending.current = null; if (mounted.current) setBusy(false); }
    });
    pending.current = job;
    await job;
  }

  useEffect(() => {
    mounted.current = true;
    const check = () => { void clean(); };
    const visible = () => { if (document.visibilityState === 'visible') check(); };
    check();
    let unsubscribe: (() => void) | undefined;
    try {
      const { data: { subscription } } = createBrowserSupabaseClient().auth.onAuthStateChange(event => {
        // INITIAL_SESSION with null is a normal guest and must never wipe an
        // explicitly saved anonymous registration input. No auth API awaited.
        if (event === 'SIGNED_OUT') void clean(true);
      });
      unsubscribe = () => subscription.unsubscribe();
    } catch { /* A missing auth connection must not invent a logout event. */ }
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false;
      unsubscribe?.();
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  if (!notice) return null;
  return <section role="alert" aria-label="端末の下書き削除" className="border-b border-amber-300 bg-amber-50 p-4 text-sm">
    <p>{busy ? '端末に保存した入力を削除しています。完了まで下書きの保存・復元は利用できません。' : LOCAL_DATA_CLEAR_FAILED}</p>
    <button type="button" disabled={busy} onClick={() => { void clean(true); }} className="mt-2 underline">端末の下書き削除を再試行</button>
  </section>;
}
