import React, { useEffect, useMemo, useState, useCallback, lazy, Suspense } from 'react';
import Header from '../components/Header';
import Filters from '../components/Filters';
import Results from '../components/Results';
const Login = lazy(() => import('./Login'));
const Support = lazy(() => import('./Support'));
const Admin = lazy(() => import('./Admin'));
const Benchmarks = lazy(() => import('./Benchmarks'));
const Auth = lazy(() => import('./Auth'));
import { supabase } from '../lib/supabaseClient';

const API_URL =
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');

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
  const [theme, setTheme] = useState<'dark'|'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    const saved = window.localStorage?.getItem('theme') as 'dark'|'light'|null;
    if (saved === 'light' || saved === 'dark') return saved;
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    return prefersLight ? 'light' : 'dark';
  });
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
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
      // If Supabase appended tokens in the hash, route to the auth callback page
      if (/access_token=|refresh_token=|type=/.test(raw)) {
        setRoute('auth');
        return;
      }
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

  // Apply theme to document
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  // Auth session and profile
  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const sess = data?.session || null;
      setSession(sess);
      if (sess?.access_token) {
        try {
          const me = await fetch(`${API_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${sess.access_token}` },
          }).then(r => r.json());
          if (me?.profile) setProfile(me.profile);
        } catch {}
      } else {
        setProfile(null);
      }
    })();
    const sub = supabase.auth.onAuthStateChange(async (_event: any, sess2: any) => {
      setSession(sess2);
      if (sess2?.access_token) {
        try {
          const me = await fetch(`${API_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${sess2.access_token}` },
          }).then(r => r.json());
          if (me?.profile) setProfile(me.profile);
        } catch { setProfile(null); }
      } else {
        setProfile(null);
      }
    });
    return () => { sub.data.subscription.unsubscribe(); };
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

  const handleLogout = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.hash = '#deals';
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try { window.localStorage?.setItem('theme', next); } catch {}
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', next);
      }
      return next;
    });
  }, []);

  return (
    <div className="container">
      <Header session={!!session} isAdmin={profile?.role === 'admin'} onLogout={handleLogout} theme={theme} onToggleTheme={toggleTheme} />
      {route === 'auth' ? (
        <section>
          <Suspense fallback={<div className="card">Verifying…</div>}>
            <Auth />
          </Suspense>
        </section>
      ) : route === 'login' ? (
        <section>
          <Suspense fallback={<div className="card">Loading…</div>}>
            <Login />
          </Suspense>
        </section>
      ) : route === 'support' ? (
        <section>
          <Suspense fallback={<div className="card">Loading…</div>}>
            <Support session={session} isAdmin={profile?.role === 'admin'} />
          </Suspense>
        </section>
      ) : route === 'admin' ? (
        <section>
          <Suspense fallback={<div className="card">Loading…</div>}>
            <Admin session={session} isAdmin={profile?.role === 'admin'} />
          </Suspense>
        </section>
      ) : route === 'benchmarks' ? (
        <>
          <section>
            <Suspense fallback={<div className="card">Loading…</div>}>
              <Benchmarks isAdmin={profile?.role === 'admin'} isAuthed={!!session} />
            </Suspense>
          </section>
        </>
      ) : (
        <>
          <section className="search-panel">
            <Filters value={filters} onChange={setFilters} onSearch={fetchResults} />
          </section>
          <section>
            {error && <div className="card" style={{borderColor:'#ef4444'}}>Error: {error}</div>}
            {loading && (
              <div className="results">
                {Array.from({length:6}).map((_,i)=> (
                  <div key={i} className="card">
                    <div className="skeleton skeleton-line" style={{width:'60%', marginBottom:8}}></div>
                    <div className="skeleton skeleton-line" style={{width:'90%', marginBottom:6}}></div>
                    <div className="skeleton skeleton-line" style={{width:'75%', marginBottom:6}}></div>
                    <div className="skeleton skeleton-line" style={{width:'40%'}}></div>
                  </div>
                ))}
              </div>
            )}
            {!loading && (
              <>
                <div className="meta" style={{marginBottom:12}}>
                  <span>Total: {count}</span>
                </div>
                <Results items={results} isAuthed={!!session} isAdmin={profile?.role === 'admin'} />
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
