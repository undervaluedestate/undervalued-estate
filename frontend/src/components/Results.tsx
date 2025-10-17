import React, { useState } from 'react';
import Logo from './Logo';
import { supabase } from '../lib/supabaseClient';

type Item = {
  id: string;
  url: string;
  title: string | null;
  price: number | null;
  currency: string;
  size_sqm: number | null;
  price_per_sqm: number | null;
  property_type: string;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  market_avg_price_per_sqm: number | null;
  pct_vs_market: number | null;
  deal_class: 'none' | 'slightly_undervalued' | 'strongly_undervalued' | 'rare_deal' | null;
};

function formatMoney(n: number | null | undefined, currency?: string, country?: string | null){
  if(n==null) return '—';
  const fallback = (country || '').toLowerCase().includes('united kingdom') ? 'GBP' : 'NGN';
  const cur = (currency || fallback).toUpperCase();
  const localeMap: Record<string, string> = { NGN: 'en-NG', GBP: 'en-GB', EUR: 'en-IE', USD: 'en-US' };
  const locale = localeMap[cur] || 'en-GB';
  try{
    return new Intl.NumberFormat(locale, { style:'currency', currency: cur as any, maximumFractionDigits:0 }).format(n);
  }catch{
    return `${n} ${cur}`;
  }
}

function DealBadge({ cls }: { cls: Item['deal_class'] }){
  if (!cls || cls === 'none') return null;
  const map: Record<string, string> = {
    slightly_undervalued: 'badge slight',
    strongly_undervalued: 'badge strong',
    rare_deal: 'badge rare',
  };
  const label: Record<string, string> = {
    slightly_undervalued: 'Slightly Undervalued',
    strongly_undervalued: 'Strongly Undervalued',
    rare_deal: 'Rare Deal',
  };
  return <span className={map[cls] || 'badge'}>{label[cls] || cls}</span>;
}

export default function Results({ items, isAuthed, isAdmin }: { items: Item[]; isAuthed?: boolean; isAdmin?: boolean }): React.ReactElement {
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [composeItem, setComposeItem] = useState<Item | null>(null);
  const [pendingItem, setPendingItem] = useState<Item | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  async function openCompose(it: Item) {
    if (!isAuthed) { setPendingItem(it); setShowLoginPrompt(true); return; }
    setComposeItem(it);
    setComposeBody(`Hi, I have a question about this listing: ${it.title || ''}`.trim());
  }

  async function sendMessage() {
    try {
      if (!supabase || !composeItem) return;
      setSending(true); setSendError('');
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess?.session?.user?.id;
      if (!userId) { setShowLoginPrompt(true); return; }
      // Ensure conversation exists
      const { data: conv, error: convErr } = await supabase
        .from('support_conversations')
        .upsert({ user_id: userId }, { onConflict: 'user_id' })
        .select('*')
        .single();
      if (convErr) throw convErr;
      const snap = {
        id: composeItem.id,
        url: composeItem.url,
        title: composeItem.title,
        price: composeItem.price,
        currency: composeItem.currency,
        city: composeItem.city,
        state: composeItem.state,
        country: composeItem.country,
        property_type: composeItem.property_type,
        bedrooms: composeItem.bedrooms,
        bathrooms: composeItem.bathrooms,
      };
      const { data: ins, error: insErr } = await supabase.from('support_messages').insert({
        conversation_id: conv!.id,
        from_role: 'user',
        sender_id: userId,
        body: composeBody || `Inquiry about listing: ${composeItem.title || composeItem.url}`,
        property_id: composeItem.id,
        property_snapshot: snap as any,
      }).select('id').single();
      if (insErr) throw insErr;
      try {
        const API_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
        await fetch(`${API_URL}/api/support/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message_id: ins?.id })
        });
      } catch {}
      setComposeItem(null);
      setComposeBody('');
      window.location.hash = '#support';
    } catch (e: any) {
      setSendError(e?.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  }
  if (!items || items.length === 0) {
    return (
      <div className="card empty-state" style={{display:'grid', placeItems:'center', textAlign:'center', padding:'32px'}}>
        <Logo size={56} className="logo-mark" />
        <div style={{marginTop:12, fontWeight:700}}>No deals found</div>
        <div style={{opacity:.8}}>Try adjusting filters or search terms.</div>
      </div>
    );
  }
  return (
    <>
    <div className="results">
      {items.map(it => (
        <article key={it.id} className="card">
          <div className="meta" style={{justifyContent:'space-between'}}>
            <div>{[it.neighborhood, it.city, it.state].filter(Boolean).join(', ')}</div>
            <DealBadge cls={it.deal_class} />
          </div>
          <div className="title">{it.title || 'Listing'}</div>
          <div className="meta">
            <span>{formatMoney(it.price, it.currency, it.country)}</span>
            <span>•</span>
            <span>{it.size_sqm ? `${it.size_sqm} sqm` : 'Size N/A'}</span>
            <span>•</span>
            <span>{it.property_type}</span>
          </div>
          <div className="meta" style={{marginTop:8}}>
            <span>Price/sqm: {it.price_per_sqm ? formatMoney(it.price_per_sqm, it.currency, it.country) : '—'}</span>
            <span>•</span>
            <span>Market: {it.market_avg_price_per_sqm ? formatMoney(it.market_avg_price_per_sqm, it.currency, it.country) : '—'}</span>
            <span>•</span>
            <span>% vs market: {it.pct_vs_market ?? '—'}%</span>
          </div>
          <div style={{marginTop:10, display:'flex', gap:8}}>
            {isAdmin ? (
              <a className="button secondary" href={it.url} target="_blank" rel="noreferrer">Open Listing</a>
            ) : (
              <a className="button secondary" href="#login" title="Admins only. Login as super user to open external listings.">Login as super user</a>
            )}
            <button className="button" onClick={() => openCompose(it)} title="Message support about this listing">💬 Message</button>
          </div>
        </article>
      ))}
    </div>
    {showLoginPrompt && (
      <div role="dialog" aria-modal="true" aria-label="Login" tabIndex={-1}
           onKeyDown={(e)=>{ if(e.key==='Escape') setShowLoginPrompt(false); }}
           onClick={()=>setShowLoginPrompt(false)}
           style={{position:'fixed', inset:0, background:'rgba(0,0,0,.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1100}}>
        <div className="card" onClick={(e)=>e.stopPropagation()} style={{maxWidth:420, width:'92%'}}>
          <div style={{fontWeight:700, marginBottom:8}}>Log in</div>
          {loginError && <div style={{color:'#ef4444', marginBottom:8}}>Error: {loginError}</div>}
          <input autoFocus type="email" placeholder="Email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} />
          <input type="password" placeholder="Password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} />
          <div className="meta" style={{justifyContent:'flex-end', marginTop:8}}>
            <button className="badge" onClick={async ()=>{
              try{
                setLoginError(''); setLoginLoading(true);
                const { error } = await supabase!.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
                if (error) throw error;
                setShowLoginPrompt(false);
                if (pendingItem) {
                  setComposeItem(pendingItem); setComposeBody(`Hi, I have a question about this listing: ${pendingItem.title || ''}`.trim()); setPendingItem(null);
                }
              }catch(e:any){ setLoginError(e?.message || 'Login failed'); }
              finally{ setLoginLoading(false); }
            }} disabled={loginLoading}>{loginLoading?'Signing in…':'Sign in'}</button>
            <button className="badge" onClick={()=>setShowLoginPrompt(false)} style={{background:'transparent'}}>Close</button>
          </div>
        </div>
      </div>
    )}
    {composeItem && (
      <div role="dialog" aria-modal="true" aria-label="Message Support" tabIndex={-1}
           onKeyDown={(e)=>{ if(e.key==='Escape' && !sending) { setComposeItem(null); setComposeBody(''); setSendError(''); } }}
           onClick={()=>{ if(!sending) { setComposeItem(null); setComposeBody(''); setSendError(''); } }}
           style={{position:'fixed', inset:0, background:'rgba(0,0,0,.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1100}}>
        <div className="card" onClick={(e)=>e.stopPropagation()} style={{maxWidth:520, width:'92%'}}>
          <div style={{fontWeight:700, marginBottom:8}}>Message Support</div>
          <div style={{opacity:.8, marginBottom:8}}>Listing: <a href={composeItem?.url} target="_blank" rel="noreferrer">{composeItem?.title || composeItem?.url}</a></div>
          {sendError && <div style={{color:'#ef4444', marginBottom:8}}>Error: {sendError}</div>}
          <textarea rows={3} value={composeBody} onChange={e=>setComposeBody(e.target.value)} placeholder="Type your message…" />
          <div className="meta" style={{justifyContent:'flex-end', marginTop:8}}>
            <button className="badge" onClick={sendMessage} disabled={sending}>{sending ? 'Sending…' : 'Send'}</button>
            <button className="badge" onClick={()=>{ if(!sending){ setComposeItem(null); setComposeBody(''); setSendError(''); } }} style={{background:'transparent'}}>Cancel</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
