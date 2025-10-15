import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin'|'signup'>('signin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setMessage('');
    if (!supabase) { setError('Auth not configured'); return; }
    try {
      setLoading(true);
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMessage('Signed in');
        window.location.hash = '#deals';
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage('Account created. You may be signed in automatically.');
        window.location.hash = '#deals';
      }
    } catch (e: any) {
      setError(e?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{maxWidth:420, margin:'0 auto'}}>
      <div className="meta" style={{justifyContent:'space-between', marginBottom:12}}>
        <div style={{fontWeight:700}}>{mode === 'signin' ? 'Sign in' : 'Create account'}</div>
        <button className="badge" onClick={()=> setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Need an account?' : 'Have an account?'}
        </button>
      </div>
      {error && <div style={{color:'#ef4444', marginBottom:8}}>Error: {error}</div>}
      {message && <div style={{color:'#16a34a', marginBottom:8}}>{message}</div>}
      <form onSubmit={onSubmit} className="meta" style={{flexDirection:'column', gap:8 as number}}>
        <input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required />
        <button className="badge" type="submit" disabled={loading}>{loading ? 'Please wait…' : (mode==='signin' ? 'Sign in' : 'Sign up')}</button>
      </form>
      <div style={{marginTop:12, opacity:.7, fontSize:12}}>Admins will be auto-promoted if their email is allowlisted on the API.</div>
    </div>
  );
}
