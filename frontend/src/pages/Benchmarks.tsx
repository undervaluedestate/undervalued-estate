/// <reference types="vite/client" />
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const API_URL =
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');

// clusters-only page

type ClusterRow = {
  country: string | null;
  state: string | null;
  city: string | null;
  property_type: string;
  currency: string;
  bedrooms: number | null;
  bathrooms: number | null;
  cluster_key_city: string | null;
  sample_count: number;
  min_price: number | null;
  median_price: number | null;
  max_price: number | null;
  avg_ppsqm: number | null;
  representative_id: string | null;
};

function formatMoney(n: number | null | undefined, currency = 'NGN'){
  if(n==null) return '—';
  try{
    return new Intl.NumberFormat('en-NG', { style:'currency', currency, maximumFractionDigits:0 }).format(n);
  }catch{
    return `${n}`;
  }
}

type BenchProps = { isAdmin?: boolean; isAuthed?: boolean };

export default function Benchmarks({ isAdmin = false, isAuthed = false }: BenchProps): React.ReactElement {
  const [filters, setFilters] = useState({
    country: 'Nigeria',
    state: '',
    city: '',
    property_type: '',
    currency: '',
    bedrooms: '',
    bathrooms: '',
  });
  const [rows, setRows] = useState<ClusterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  type ClusterStats = { sample_count: number; min_price: number | null; median_price: number | null; max_price: number | null; avg_ppsqm: number | null };
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, { loading: boolean; error: string; stats?: ClusterStats; items?: any[]; page: number }>>({});
  const [cities, setCities] = useState<{ name: string; count: number }[]>([]);
  const [citiesLoading, setCitiesLoading] = useState<boolean>(false);
  const [citiesError, setCitiesError] = useState<string>('');
  const [countries, setCountries] = useState<string[]>([]);
  const [countriesLoading, setCountriesLoading] = useState<boolean>(false);
  const [countriesError, setCountriesError] = useState<string>('');
  const [detailOrder, setDetailOrder] = useState<'asc'|'desc'>('asc');
  const [openImages, setOpenImages] = useState<Record<string, Record<string, boolean>>>({});
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showLoginPrompt, setShowLoginPrompt] = useState<boolean>(false);
  const [pendingItem, setPendingItem] = useState<any | null>(null);
  const [composeItem, setComposeItem] = useState<any | null>(null);
  const [composeBody, setComposeBody] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);
  const [sendError, setSendError] = useState<string>('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  async function sendSupportMessage() {
    try {
      if (!supabase) return; if (!composeItem) return;
      setSending(true); setSendError('');
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess?.session?.user?.id; if (!userId) { setShowLoginPrompt(true); return; }
      const { data: conv, error: convErr } = await supabase.from('support_conversations').upsert({ user_id: userId }, { onConflict: 'user_id' }).select('*').single();
      if (convErr) throw convErr;
      const snap = { id: composeItem.id, url: composeItem.url, title: composeItem.title, price: composeItem.price, currency: composeItem.currency, city: composeItem.city, state: composeItem.state, country: composeItem.country, property_type: composeItem.property_type, bedrooms: composeItem.bedrooms, bathrooms: composeItem.bathrooms };
      const { data: ins, error: insErr } = await supabase.from('support_messages').insert({ conversation_id: conv!.id, from_role: 'user', sender_id: userId, body: composeBody || `Inquiry about listing: ${composeItem.title || composeItem.url}`, property_id: composeItem.id, property_snapshot: snap as any }).select('id').single();
      if (insErr) throw insErr;
      try { const API_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : ''); await fetch(`${API_URL}/api/support/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message_id: ins?.id }) }); } catch {}
      setComposeItem(null); setComposeBody(''); window.location.hash = '#support';
    } catch (e: any) { setSendError(e?.message || 'Failed to send'); } finally { setSending(false); }
  }

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    (Object.entries(filters) as [string, string][]).forEach(([k,v]) => {
      if (v !== '' && v != null) params.set(k, v);
    });
    return params.toString();
  }, [filters]);

  async function fetchClusters(){
    setLoading(true); setError('');
    try{
      if (!filters.city) { setRows([]); return; }
      const res = await fetch(`${API_URL}/api/clusters/city?${queryString}`);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRows((json.data as ClusterRow[]) || []);
    }catch(e:any){
      setError(e.message || 'Failed to load');
    }finally{
      setLoading(false);
    }
  }

  useEffect(() => { fetchClusters(); }, [queryString]);

  async function fetchCities(){
    setCitiesLoading(true); setCitiesError('');
    try{
      const p = new URLSearchParams();
      if (filters.country) p.set('country', filters.country);
      const res = await fetch(`${API_URL}/api/clusters/cities?${p.toString()}`);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setCities((json.data as {name:string; count:number}[]) || []);
    }catch(e:any){
      setCitiesError(e.message || 'Failed to load cities');
    }finally{
      setCitiesLoading(false);
    }
  }

  useEffect(() => { fetchCities(); }, [filters.country]);

  async function fetchCountries(){
    setCountriesLoading(true); setCountriesError('');
    try{
      const res = await fetch(`${API_URL}/api/clusters/countries`);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setCountries((json.data as string[]) || []);
    }catch(e:any){
      setCountriesError(e.message || 'Failed to load countries');
    }finally{
      setCountriesLoading(false);
    }
  }

  useEffect(() => { fetchCountries(); }, []);

  return (
    <>
    <section>
      <div className="card" style={{marginBottom:12}}>
        <div className="filters">
          <select className="select" value={filters.country} onChange={e=>setFilters({...filters, country: e.target.value, city: ''})}>
            <option value="">Select country… {countriesLoading ? '(loading…)': ''}</option>
            {countries.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {countriesError && <span style={{color:'var(--warning)'}}>Countries: {countriesError}</span>}
          <select className="select" value={filters.city} onChange={e=>setFilters({...filters, city: e.target.value})}>
            <option value="">Select city… {citiesLoading ? '(loading…)': ''}</option>
            {cities.map(c => (
              <option key={c.name} value={c.name}>{c.name} {c.count ? `(${c.count})` : ''}</option>
            ))}
          </select>
          <select className="select" value={filters.property_type} onChange={e=>setFilters({...filters, property_type: e.target.value})}>
            <option value="">Any type</option>
            <option value="house">House</option>
            <option value="apartment">Apartment</option>
            <option value="duplex">Duplex</option>
            <option value="townhouse">Townhouse</option>
            <option value="condo">Condo</option>
            <option value="studio">Studio</option>
            <option value="land">Land</option>
            <option value="other">Other</option>
          </select>
          <select className="select" value={filters.currency} onChange={e=>setFilters({...filters, currency: e.target.value})}>
            <option value="">Any currency</option>
            <option value="NGN">NGN</option>
            <option value="GBP">GBP</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
          <input className="input" placeholder="Bedrooms" value={filters.bedrooms} onChange={e=>setFilters({...filters, bedrooms: e.target.value})} />
          <input className="input" placeholder="Bathrooms" value={filters.bathrooms} onChange={e=>setFilters({...filters, bathrooms: e.target.value})} />
        </div>
        <div className="meta" style={{justifyContent:'space-between', marginTop:8}}>
          <div style={{display:'flex', gap:8, alignItems:'center'}}>
            <span style={{opacity:.8}}>Detail sort:</span>
            <div className="segmented">
              <button className={`seg ${detailOrder==='asc'?'active':''}`} onClick={()=>setDetailOrder('asc')}>Price ↑</button>
              <button className={`seg ${detailOrder==='desc'?'active':''}`} onClick={()=>setDetailOrder('desc')}>Price ↓</button>
            </div>
          </div>
          {citiesError && <div style={{color:'var(--warning)'}}>Cities: {citiesError}</div>}
        </div>
      </div>

      {error && <div className="card" style={{borderColor:'#ef4444'}}>Error: {error}</div>}
      {loading && (
        <div className="card">
          <div className="skeleton skeleton-line" style={{width:'40%', marginBottom:10}}></div>
          <div className="skeleton skeleton-line" style={{width:'70%', marginBottom:10}}></div>
          <div className="skeleton skeleton-line" style={{width:'55%'}}></div>
        </div>
      )}
      {!loading && !filters.city && (
        <div className="card">Enter a city to load clusters.</div>
      )}

      {!loading && (
        <div className="card">
          <div className="table" style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  <th className="col-country" style={{textAlign:'left'}}>Country</th>
                  <th className="col-state" style={{textAlign:'left'}}>State</th>
                  <th className="col-city" style={{textAlign:'left'}}>City</th>
                  <th className="col-type" style={{textAlign:'left'}}>Type</th>
                  <th className="col-currency" style={{textAlign:'left'}}>Currency</th>
                  <th className="col-beds" style={{textAlign:'right'}}>Beds</th>
                  <th className="col-baths" style={{textAlign:'right'}}>Baths</th>
                  <th className="col-key" style={{textAlign:'left'}}>Cluster Key</th>
                  <th className="col-sample" style={{textAlign:'right'}}>Sample</th>
                  <th className="col-min" style={{textAlign:'right'}}>Min</th>
                  <th className="col-median" style={{textAlign:'right'}}>Median</th>
                  <th className="col-max" style={{textAlign:'right'}}>Max</th>
                  <th className="col-ppsqm" style={{textAlign:'right'}}>Avg ppsqm</th>
                  {isAdmin && <th style={{textAlign:'right'}}>See Listings</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const rowKey = [r.country || '', r.state || '', r.city || '', r.property_type, r.currency, r.bedrooms ?? '', r.bathrooms ?? ''].join('|');
                  const params = new URLSearchParams();
                  if (r.country) params.set('country', r.country);
                  if (r.state) params.set('state', r.state);
                  if (r.city) params.set('city', r.city);
                  if (r.property_type) params.set('property_type', r.property_type);
                  if (r.currency) params.set('currency', r.currency);
                  if (r.bedrooms != null) params.set('bedrooms', String(r.bedrooms));
                  if (r.bathrooms != null) params.set('bathrooms', String(r.bathrooms));
                  params.set('sort', 'price');
                  params.set('order', detailOrder);
                  async function ensureDetail(){
                    // initialize
                    setDetails(prev => prev[rowKey] ? prev : { ...prev, [rowKey]: { loading: true, error: '', page: 1 } });
                    try{
                      const resp = await fetch(`${API_URL}/api/clusters/city/detail?${params.toString()}&page=1&per_page=10`);
                      if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
                      const j = await resp.json();
                      setDetails(prev => ({ ...prev, [rowKey]: { loading: false, error: '', stats: j.stats as ClusterStats, items: j.data as any[], page: 1 } }));
                    }catch(e:any){
                      setDetails(prev => ({ ...prev, [rowKey]: { loading: false, error: e.message || 'Failed to load', page: 1 } }));
                    }
                  }
                  const onRowClick = async () => {
                    if (expandedKey === rowKey) { setExpandedKey(null); return; }
                    setExpandedKey(rowKey);
                    if (!details[rowKey]) await ensureDetail();
                  };
                  const adminDealsHref = `#deals?${params.toString()}`;
                  return (
                  <>
                  <tr key={`${idx}-row`} onClick={onRowClick} className="row-hover" style={{cursor:'pointer'}}>
                    <td className="col-country">{r.country || ''}</td>
                    <td className="col-state">{r.state || ''}</td>
                    <td className="col-city">{r.city || ''}</td>
                    <td className="col-type">{r.property_type}</td>
                    <td className="col-currency">{r.currency}</td>
                    <td className="col-beds" style={{textAlign:'right'}}>{r.bedrooms ?? ''}</td>
                    <td className="col-baths" style={{textAlign:'right'}}>{r.bathrooms ?? ''}</td>
                    <td className="col-key">{r.cluster_key_city || ''}</td>
                    <td className="col-sample" style={{textAlign:'right'}}>{r.sample_count}</td>
                    <td className="col-min" style={{textAlign:'right'}}>{formatMoney(r.min_price, r.currency)}</td>
                    <td className="col-median" style={{textAlign:'right'}}>{formatMoney(r.median_price, r.currency)}</td>
                    <td className="col-max" style={{textAlign:'right'}}>{formatMoney(r.max_price, r.currency)}</td>
                    <td className="col-ppsqm" style={{textAlign:'right'}}>{formatMoney(r.avg_ppsqm, r.currency)}</td>
                    {isAdmin && (
                      <td style={{textAlign:'right'}}>
                        <a className="badge" href={adminDealsHref} onClick={(e)=> e.stopPropagation()}>
                          See Listings
                        </a>
                      </td>
                    )}
                  </tr>
                  {expandedKey === rowKey && (
                    <tr key={`${idx}-detail`}>
                      <td colSpan={isAdmin ? 14 : 13}>
                        <div className={`collapse ${expandedKey === rowKey ? 'open' : ''}`}>
                          <div className="card" style={{marginTop:8}}>
                            {details[rowKey]?.loading && <div>Loading listings…</div>}
                            {!!details[rowKey]?.error && <div style={{color:'#ef4444'}}>Error: {details[rowKey]?.error}</div>}
                            {!!details[rowKey]?.stats && (
                              <div className="meta" style={{justifyContent:'space-between'}}>
                                <div>Sample: {details[rowKey]!.stats!.sample_count}</div>
                                <div>Min: {formatMoney(details[rowKey]!.stats!.min_price, r.currency)}</div>
                                <div>Median: {formatMoney(details[rowKey]!.stats!.median_price, r.currency)}</div>
                                <div>Max: {formatMoney(details[rowKey]!.stats!.max_price, r.currency)}</div>
                                <div>Avg ppsqm: {formatMoney(details[rowKey]!.stats!.avg_ppsqm, r.currency)}</div>
                              </div>
                            )}
                            <div style={{marginTop:8}}>
                              {(details[rowKey]?.items || []).map((it: any) => {
                                const toggle = () => {
                                  if (!isAuthed) { setShowLoginPrompt(true); return; }
                                  setOpenImages(prev => {
                                    const next = { ...prev } as Record<string, Record<string, boolean>>;
                                    const perRow = { ...(next[rowKey] || {}) };
                                    perRow[it.id] = !perRow[it.id];
                                    next[rowKey] = perRow;
                                    return next;
                                  });
                                };
                                const ptLabel = it.property_type_label || (it.property_type ? String(it.property_type).charAt(0).toUpperCase() + String(it.property_type).slice(1) : '');
                                const rawImgs: string[] = Array.isArray(it.images) ? (it.images as string[]).filter(Boolean) : [];
                                const uniqImages: string[] = Array.from(new Set(rawImgs.map((s: string) => {
                                  try { return new URL(String(s), it.url).toString(); } catch { return String(s); }
                                }).filter(Boolean))).slice(0, 12) as string[];
                                const open = isAuthed && !!(openImages[rowKey] && openImages[rowKey][it.id]);
                                const onMessage = () => {
                                  if (!isAuthed) { setPendingItem(it); setShowLoginPrompt(true); return; }
                                  setComposeItem(it);
                                  setComposeBody(`Hi, I have a question about this listing: ${it.title || ''}`.trim());
                                };
                                // use sendSupportMessage at component scope
                                return (
                                  <div key={it.id} style={{padding:'8px 0', borderTop:'1px solid var(--border)'}}> 
                                    <div className="meta row-hover" role="button" tabIndex={0} onClick={toggle} onKeyDown={(e)=>{ if(e.key==='Enter') toggle(); }} style={{justifyContent:'space-between', cursor:'pointer'}}>
                                      <div style={{display:'flex', gap:8, alignItems:'center'}}>
                                        {ptLabel && <span className="badge" style={{background:'var(--panel-subtle)'}}>{ptLabel}</span>}
                                        <div style={{fontWeight:600}}>{it.title || 'Listing'}</div>
                                        <div style={{opacity:.8}}>{[it.neighborhood, it.city, it.state].filter(Boolean).join(', ')}</div>
                                      </div>
                                      <div style={{display:'flex', gap:8, alignItems:'center'}}>
                                        <div>{formatMoney(it.price, it.currency)}</div>
                                        <div>•</div>
                                        <div>{it.size_sqm ? `${it.size_sqm} sqm` : '—'}</div>
                                        <div>•</div>
                                        <div>{it.price_per_sqm ? formatMoney(it.price_per_sqm, it.currency) : '—'} /sqm</div>
                                        <div style={{display:'flex', gap:8}}>
                                          <a className="badge" href={it.url} target="_blank" rel="noreferrer" onClick={(e)=>e.stopPropagation()}>Open Listing</a>
                                          <button className="badge" onClick={(e)=>{ e.stopPropagation(); onMessage(); }}>💬 Message</button>
                                        </div>
                                      </div>
                                    </div>
                                    {open && (
                                      <div style={{marginTop:8}}>
                                        {uniqImages.length ? (
                                          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))', gap:8}}>
                                            {uniqImages.map((u: string) => (
                                              <img key={u} src={u} alt="Listing image" style={{width:'100%', height:120, objectFit:'cover', borderRadius:6, border:'1px solid var(--border-soft)', background:'var(--panel)'}} onClick={(e)=>{ e.stopPropagation(); setLightboxSrc(u); }} />
                                            ))}
                                          </div>
                                        ) : (
                                          <div style={{opacity:.7}}>No images for this listing.</div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={13} style={{opacity:.7, padding:'12px 0'}}>No clusters found for current filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
    {lightboxSrc && (
      <div onClick={()=>setLightboxSrc(null)} style={{position:'fixed', inset:0, background:'rgba(0,0,0,.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000}}>
        <img src={lightboxSrc || undefined} alt="Preview" style={{maxWidth:'90vw', maxHeight:'90vh', objectFit:'contain', borderRadius:8, boxShadow:'0 10px 30px rgba(0,0,0,.4)'}} />
      </div>
    )}
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
              try{ setLoginError(''); setLoginLoading(true); const { error } = await supabase!.auth.signInWithPassword({ email: loginEmail, password: loginPassword }); if (error) throw error; setShowLoginPrompt(false); if (pendingItem) { setComposeItem(pendingItem); setComposeBody(`Hi, I have a question about this listing: ${pendingItem.title || ''}`.trim()); setPendingItem(null);} }
              catch(e:any){ setLoginError(e?.message || 'Login failed'); }
              finally{ setLoginLoading(false); }
            }} disabled={loginLoading}>{loginLoading?'Signing in…':'Sign in'}</button>
            <button className="badge" onClick={()=>setShowLoginPrompt(false)} style={{background:'transparent'}}>Close</button>
          </div>
        </div>
      </div>
    )}
    {composeItem && (
      <div role="dialog" aria-modal="true" aria-label="Message Support" tabIndex={-1}
           onKeyDown={(e)=>{ if(e.key==='Escape' && !sending){ setComposeItem(null); setComposeBody(''); setSendError(''); } }}
           onClick={()=>{ if(!sending){ setComposeItem(null); setComposeBody(''); setSendError(''); } }}
           style={{position:'fixed', inset:0, background:'rgba(0,0,0,.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1100}}>
        <div className="card" onClick={(e)=>e.stopPropagation()} style={{maxWidth:520, width:'92%'}}>
          <div style={{fontWeight:700, marginBottom:8}}>Message Support</div>
          {sendError && <div style={{color:'#ef4444', marginBottom:8}}>Error: {sendError}</div>}
          <textarea rows={3} value={composeBody} onChange={e=>setComposeBody(e.target.value)} placeholder="Type your message…" />
          <div className="meta" style={{justifyContent:'flex-end', marginTop:8}}>
            <button className="badge" onClick={sendSupportMessage} disabled={sending}>{sending?'Sending…':'Send'}</button>
            <button className="badge" onClick={()=>{ if(!sending){ setComposeItem(null); setComposeBody(''); setSendError(''); } }} style={{background:'transparent'}}>Cancel</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
