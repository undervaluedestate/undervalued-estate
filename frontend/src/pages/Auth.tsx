import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function AuthCallback(): React.ReactElement {
  const [status, setStatus] = useState<'checking'|'verified'|'redirecting'>('checking');

  useEffect(() => {
    let unsub: any;
    (async () => {
      try {
        // Give supabase-js a moment to parse the URL hash tokens
        setTimeout(async () => {
          const { data } = await supabase!.auth.getSession();
          if (data?.session) {
            setStatus('verified');
            // Clean up URL tokens (if any were present)
            try {
              const clean = `${window.location.origin}${window.location.pathname}#auth`;
              window.history.replaceState({}, document.title, clean);
            } catch {}
            setTimeout(() => { window.location.hash = '#deals'; }, 600);
          } else {
            setStatus('checking');
          }
        }, 200);
        unsub = supabase!.auth.onAuthStateChange((_event, sess) => {
          if (sess) {
            setStatus('verified');
            try {
              const clean = `${window.location.origin}${window.location.pathname}#auth`;
              window.history.replaceState({}, document.title, clean);
            } catch {}
            setTimeout(() => { window.location.hash = '#deals'; }, 600);
          }
        });
      } catch {
        setTimeout(() => { window.location.hash = '#deals'; }, 800);
      }
    })();
    return () => { try { unsub?.data?.subscription?.unsubscribe?.(); } catch {} };
  }, []);

  return (
    <div className="card" style={{maxWidth:420, margin:'0 auto', textAlign:'center'}}>
      <div style={{fontWeight:700, marginBottom:8}}>Verifying your email…</div>
      <div style={{opacity:.8}}>
        {status === 'checking' && 'One moment while we verify your account.'}
        {status === 'verified' && 'Success! Redirecting you to your dashboard…'}
        {status === 'redirecting' && 'Redirecting…'}
      </div>
    </div>
  );
}
