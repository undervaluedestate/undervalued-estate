/// <reference types="vite/client" />
import React, { useEffect, useMemo, useState } from 'react';

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

export default function Benchmarks(): React.ReactElement {
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
  const [detailOrder, setDetailOrder] = useState<'asc'|'desc'>('asc');

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

  return (
    <section>
      <div className="card" style={{marginBottom:12}}>
        <div className="filters">
          <input className="input" placeholder="Country" value={filters.country} onChange={e=>setFilters({...filters, country: e.target.value, city: ''})} />
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
      {loading && <div className="card">Loading clusters…</div>}
      {!loading && !filters.city && (
        <div className="card">Enter a city to load clusters.</div>
      )}

      {!loading && (
        <div className="card">
          <div className="table" style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  <th style={{textAlign:'left'}}>Country</th>
                  <th style={{textAlign:'left'}}>State</th>
                  <th style={{textAlign:'left'}}>City</th>
                  <th style={{textAlign:'left'}}>Type</th>
                  <th style={{textAlign:'left'}}>Currency</th>
                  <th style={{textAlign:'right'}}>Beds</th>
                  <th style={{textAlign:'right'}}>Baths</th>
                  <th style={{textAlign:'left'}}>Cluster Key</th>
                  <th style={{textAlign:'right'}}>Sample</th>
                  <th style={{textAlign:'right'}}>Min</th>
                  <th style={{textAlign:'right'}}>Median</th>
                  <th style={{textAlign:'right'}}>Max</th>
                  <th style={{textAlign:'right'}}>Avg ppsqm</th>
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
                  return (
                  <>
                  <tr key={`${idx}-row`} onClick={onRowClick} className="row-hover" style={{cursor:'pointer'}}>
                    <td>{r.country || ''}</td>
                    <td>{r.state || ''}</td>
                    <td>{r.city || ''}</td>
                    <td>{r.property_type}</td>
                    <td>{r.currency}</td>
                    <td style={{textAlign:'right'}}>{r.bedrooms ?? ''}</td>
                    <td style={{textAlign:'right'}}>{r.bathrooms ?? ''}</td>
                    <td>{r.cluster_key_city || ''}</td>
                    <td style={{textAlign:'right'}}>{r.sample_count}</td>
                    <td style={{textAlign:'right'}}>{formatMoney(r.min_price, r.currency)}</td>
                    <td style={{textAlign:'right'}}>{formatMoney(r.median_price, r.currency)}</td>
                    <td style={{textAlign:'right'}}>{formatMoney(r.max_price, r.currency)}</td>
                    <td style={{textAlign:'right'}}>{formatMoney(r.avg_ppsqm, r.currency)}</td>
                  </tr>
                  {expandedKey === rowKey && (
                    <tr key={`${idx}-detail`}>
                      <td colSpan={13}>
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
                              {(details[rowKey]?.items || []).map((it: any) => (
                                <div key={it.id} className="meta" style={{justifyContent:'space-between', padding:'8px 0', borderTop:'1px solid rgba(255,255,255,.06)'}}>
                                  <div style={{display:'flex', gap:8}}>
                                    <div style={{fontWeight:600}}>{it.title || 'Listing'}</div>
                                    <div style={{opacity:.8}}>{[it.neighborhood, it.city, it.state].filter(Boolean).join(', ')}</div>
                                  </div>
                                  <div style={{display:'flex', gap:8}}>
                                    <div>{formatMoney(it.price, it.currency)}</div>
                                    <div>•</div>
                                    <div>{it.size_sqm ? `${it.size_sqm} sqm` : '—'}</div>
                                    <div>•</div>
                                    <div>{it.price_per_sqm ? formatMoney(it.price_per_sqm, it.currency) : '—'} /sqm</div>
                                    <div><a className="badge" href={it.url} target="_blank" rel="noreferrer">Open Listing</a></div>
                                  </div>
                                </div>
                              ))}
                              {(!details[rowKey] || (details[rowKey]?.items || []).length === 0) && !details[rowKey]?.loading && (
                                <div style={{opacity:.7}}>No listings in this cluster.</div>
                              )}
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
  );
}
