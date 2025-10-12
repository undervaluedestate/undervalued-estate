/// <reference types="vite/client" />
import React, { useEffect, useMemo, useState } from 'react';

const API_URL =
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');

type BenchmarkRow = {
  country: string | null;
  state: string | null;
  city: string | null;
  neighborhood: string | null;
  property_type: string;
  currency: string;
  computed_on: string; // date
  avg_price_per_sqm: number;
  p25_price_per_sqm: number | null;
  p50_price_per_sqm: number | null;
  p75_price_per_sqm: number | null;
  sample_count: number;
};

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
  const [mode, setMode] = useState<'benchmarks' | 'clusters'>('benchmarks');
  const [filters, setFilters] = useState({
    country: 'Nigeria',
    state: '',
    city: '',
    neighborhood: '',
    property_type: '',
    currency: '',
    bedrooms: '',
    bathrooms: '',
  });
  const [rows, setRows] = useState<BenchmarkRow[] | ClusterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    (Object.entries(filters) as [string, string][]).forEach(([k,v]) => {
      if (v !== '' && v != null) params.set(k, v);
    });
    return params.toString();
  }, [filters]);

  async function fetchBenchmarks(){
    setLoading(true); setError('');
    try{
      const res = await fetch(`${API_URL}/api/benchmarks?${queryString}`);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRows((json.data as BenchmarkRow[]) || []);
    }catch(e:any){
      setError(e.message || 'Failed to load');
    }finally{
      setLoading(false);
    }
  }

  async function fetchClusters(){
    setLoading(true); setError('');
    try{
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

  useEffect(() => { (mode === 'benchmarks' ? fetchBenchmarks() : fetchClusters()); }, [queryString, mode]);

  return (
    <section>
      <div className="card" style={{marginBottom:12}}>
        <div className="filters">
          <input className="input" placeholder="Country" value={filters.country} onChange={e=>setFilters({...filters, country: e.target.value})} />
          <input className="input" placeholder="State" value={filters.state} onChange={e=>setFilters({...filters, state: e.target.value})} />
          <input className="input" placeholder="City" value={filters.city} onChange={e=>setFilters({...filters, city: e.target.value})} />
          {mode === 'benchmarks' && (
            <input className="input" placeholder="Neighborhood" value={filters.neighborhood} onChange={e=>setFilters({...filters, neighborhood: e.target.value})} />
          )}
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
        <div className="actions" style={{marginTop:12}}>
          <div className="badge" style={{cursor:'pointer'}} onClick={()=>setMode('benchmarks')}>Benchmarks</div>
          <div className="badge" style={{cursor:'pointer'}} onClick={()=>setMode('clusters')}>Clusters</div>
        </div>
      </div>

      {error && <div className="card" style={{borderColor:'#ef4444'}}>Error: {error}</div>}
      {loading && <div className="card">Loading benchmarks…</div>}

      {!loading && mode === 'benchmarks' && (
        <div className="card">
          <div className="table" style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  <th style={{textAlign:'left'}}>Country</th>
                  <th style={{textAlign:'left'}}>State</th>
                  <th style={{textAlign:'left'}}>City</th>
                  <th style={{textAlign:'left'}}>Neighborhood</th>
                  <th style={{textAlign:'left'}}>Type</th>
                  <th style={{textAlign:'right'}}>Avg ppsqm</th>
                  <th style={{textAlign:'right'}}>P50 ppsqm</th>
                  <th style={{textAlign:'right'}}>P25 ppsqm</th>
                  <th style={{textAlign:'right'}}>P75 ppsqm</th>
                  <th style={{textAlign:'right'}}>Sample</th>
                  <th style={{textAlign:'left'}}>Computed</th>
                  <th style={{textAlign:'left'}}>Listings</th>
                </tr>
              </thead>
              <tbody>
                {(rows as BenchmarkRow[]).map((r, idx) => {
                  const params = new URLSearchParams();
                  if (r.country) params.set('country', r.country);
                  if (r.state) params.set('state', r.state);
                  if (r.city) params.set('city', r.city);
                  if (r.neighborhood) params.set('neighborhood', r.neighborhood);
                  if (r.property_type) params.set('property_type', r.property_type);
                  params.set('sort', 'scraped_at');
                  params.set('order', 'desc');
                  const href = `#deals?${params.toString()}`;
                  return (
                  <tr key={idx} onClick={() => (window.location.hash = href.replace('#',''))} style={{cursor:'pointer'}}>
                    <td>{r.country || ''}</td>
                    <td>{r.state || ''}</td>
                    <td>{r.city || ''}</td>
                    <td>{r.neighborhood || ''}</td>
                    <td>{r.property_type}</td>
                    <td style={{textAlign:'right'}}>{formatMoney(r.avg_price_per_sqm, r.currency)}</td>
                    <td style={{textAlign:'right'}}>{formatMoney(r.p50_price_per_sqm, r.currency)}</td>
                    <td style={{textAlign:'right'}}>{formatMoney(r.p25_price_per_sqm, r.currency)}</td>
                    <td style={{textAlign:'right'}}>{formatMoney(r.p75_price_per_sqm, r.currency)}</td>
                    <td style={{textAlign:'right'}}>{r.sample_count}</td>
                    <td>{new Date(r.computed_on).toLocaleDateString()}</td>
                    <td><a className="badge" href={href} onClick={(e) => { e.stopPropagation(); }}>{'View'}</a></td>
                  </tr>
                )})}
                {(rows as BenchmarkRow[]).length === 0 && (
                  <tr>
                    <td colSpan={12} style={{opacity:.7, padding:'12px 0'}}>No benchmarks found for current filters.</td>
                  </tr>
                )}
      {!loading && mode === 'clusters' && (
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
                  <th style={{textAlign:'right'}}>Sample</th>
                  <th style={{textAlign:'right'}}>Min</th>
                  <th style={{textAlign:'right'}}>Median</th>
                  <th style={{textAlign:'right'}}>Max</th>
                  <th style={{textAlign:'right'}}>Avg ppsqm</th>
                  <th style={{textAlign:'left'}}>Listings</th>
                </tr>
              </thead>
              <tbody>
                {(rows as ClusterRow[]).map((r, idx) => {
                  const params = new URLSearchParams();
                  if (r.country) params.set('country', r.country);
                  if (r.state) params.set('state', r.state);
                  if (r.city) params.set('city', r.city);
                  if (r.property_type) params.set('property_type', r.property_type);
                  if (r.currency) params.set('currency', r.currency);
                  if (r.bedrooms != null) params.set('bedrooms', String(r.bedrooms));
                  if (r.bathrooms != null) params.set('bathrooms', String(r.bathrooms));
                  params.set('sort', 'scraped_at');
                  params.set('order', 'desc');
                  const href = `#deals?${params.toString()}`;
                  return (
                  <tr key={idx} onClick={() => (window.location.hash = href.replace('#',''))} style={{cursor:'pointer'}}>
                    <td>{r.country || ''}</td>
                    <td>{r.state || ''}</td>
                    <td>{r.city || ''}</td>
                    <td>{r.property_type}</td>
                    <td>{r.currency}</td>
                    <td style={{textAlign:'right'}}>{r.bedrooms ?? ''}</td>
                    <td style={{textAlign:'right'}}>{r.bathrooms ?? ''}</td>
                    <td style={{textAlign:'right'}}>{r.sample_count}</td>
                    <td style={{textAlign:'right'}}>{formatMoney(r.min_price, r.currency)}</td>
                    <td style={{textAlign:'right'}}>{formatMoney(r.median_price, r.currency)}</td>
                    <td style={{textAlign:'right'}}>{formatMoney(r.max_price, r.currency)}</td>
                    <td style={{textAlign:'right'}}>{formatMoney(r.avg_ppsqm, r.currency)}</td>
                    <td><a className="badge" href={href} onClick={(e) => { e.stopPropagation(); }}>{'View'}</a></td>
                  </tr>
                )})}
                {(rows as ClusterRow[]).length === 0 && (
                  <tr>
                    <td colSpan={13} style={{opacity:.7, padding:'12px 0'}}>No clusters found for current filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
