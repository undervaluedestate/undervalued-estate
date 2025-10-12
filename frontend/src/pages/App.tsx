import React, { useEffect, useMemo, useState } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Header from '../components/Header';
import Filters from '../components/Filters';
import Results from '../components/Results';
import Benchmarks from './Benchmarks';

const API_URL =
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');
const SUPABASE_URL: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase: SupabaseClient | null = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

type FiltersState = {
  q: string;
  country: string;
  state: string;
  city: string;
  neighborhood: string;
  property_type: string;
  currency: string;
  bedrooms: string;
  bathrooms: string;
  min_price: string;
  max_price: string;
  min_size_sqm: string;
  max_size_sqm: string;
  min_pct_below: string;
  deal_type: string;
  sort: string;
  order: string;
};

export default function App(){
  const [route, setRoute] = useState<string>(() => (typeof window !== 'undefined' ? (window.location.hash.replace('#','') || 'deals') : 'deals'));
  const [filters, setFilters] = useState<FiltersState>({
    q: '',
    country: 'Nigeria',
    state: '',
    city: '',
    neighborhood: '',
    property_type: '',
    currency: '',
    bedrooms: '',
    bathrooms: '',
    min_price: '',
    max_price: '',
    min_size_sqm: '',
    max_size_sqm: '',
    min_pct_below: '',
    deal_type: '',
    sort: 'final_pct_vs_market',
    order: 'asc',
  });
  const [results, setResults] = useState<any[]>([]);
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    function applyHash(){
      const raw = window.location.hash.replace('#','');
      const [r, qs] = raw.split('?');
      const nextRoute = r || 'deals';
      setRoute(nextRoute);
      if (qs && nextRoute === 'deals') {
        const params = new URLSearchParams(qs);
        setFilters(prev => {
          const next = { ...prev };
          for (const [k, v] of params.entries()) {
            if ((k as keyof typeof prev) in prev) {
              (next as any)[k] = v;
            }
          }
          return next;
        });
      }
    }
    window.addEventListener('hashchange', applyHash);
    applyHash();
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    (Object.entries(filters) as [string, string][]).forEach(([k,v]) => {
      if (v !== '' && v != null) params.set(k, v);
    });
    params.set('page', '1');
    params.set('per_page', '24');
    return params.toString();
  }, [filters]);

  async function fetchResults(){
    setLoading(true); setError('');
    try{
      const res = await fetch(`${API_URL}/api/properties?${queryString}`);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setResults(json.data || []);
      setCount(json.count || 0);
    }catch(e:any){
      setError(e.message || 'Failed to load');
    }finally{
      setLoading(false);
    }
  }

  useEffect(() => { if(route === 'deals') fetchResults(); }, [queryString, route]);

  // Optional: Realtime subscription to properties
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase.channel('realtime:properties')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, () => {
        fetchResults();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  return (
    <div className="container">
      <Header />
      {route === 'benchmarks' ? (
        <>
          <section>
            <Benchmarks />
          </section>
        </>
      ) : (
        <>
          <section className="search-panel">
            <Filters value={filters} onChange={setFilters} onSearch={fetchResults} />
          </section>
          <section>
            {error && <div className="card" style={{borderColor:'#ef4444'}}>Error: {error}</div>}
            {loading && <div className="card">Loading deals…</div>}
            {!loading && (
              <>
                <div className="meta" style={{marginBottom:12}}>
                  <span>Total: {count}</span>
                </div>
                <Results items={results} />
              </>
            )}
          </section>
        </>
      )}
      <footer className="footer">
        <div>© {new Date().getFullYear()} Undervalued Estate — Find properties priced below market.</div>
      </footer>
    </div>
  );
}
