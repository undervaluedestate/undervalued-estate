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
    neighborhood: '',
    property_type: '',
  });
  const [rows, setRows] = useState<BenchmarkRow[]>([]);
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

  useEffect(() => { fetchBenchmarks(); }, [queryString]);

  return (
    <section>
      <div className="card" style={{marginBottom:12}}>
        <div className="filters">
          <input className="input" placeholder="Country" value={filters.country} onChange={e=>setFilters({...filters, country: e.target.value})} />
          <input className="input" placeholder="State" value={filters.state} onChange={e=>setFilters({...filters, state: e.target.value})} />
          <input className="input" placeholder="City" value={filters.city} onChange={e=>setFilters({...filters, city: e.target.value})} />
          <input className="input" placeholder="Neighborhood" value={filters.neighborhood} onChange={e=>setFilters({...filters, neighborhood: e.target.value})} />
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
          <button className="button" onClick={fetchBenchmarks}>Refresh</button>
        </div>
      </div>

      {error && <div className="card" style={{borderColor:'#ef4444'}}>Error: {error}</div>}
      {loading && <div className="card">Loading benchmarks…</div>}

      {!loading && (
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
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={idx}>
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
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={11} style={{opacity:.7, padding:'12px 0'}}>No benchmarks found for current filters.</td>
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
