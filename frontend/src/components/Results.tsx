import React from 'react';

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

function formatMoney(n: number | null | undefined){
  if(n==null) return '—';
  try{
    return new Intl.NumberFormat('en-NG', { style:'currency', currency:'NGN', maximumFractionDigits:0 }).format(n);
  }catch{
    return `${n}`;
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

export default function Results({ items }: { items: Item[] }): JSX.Element {
  return (
    <div className="results">
      {items.map(it => (
        <article key={it.id} className="card">
          <div className="meta" style={{justifyContent:'space-between'}}>
            <div>{[it.neighborhood, it.city, it.state].filter(Boolean).join(', ')}</div>
            <DealBadge cls={it.deal_class} />
          </div>
          <div className="title">{it.title || 'Listing'}</div>
          <div className="meta">
            <span>{formatMoney(it.price)}</span>
            <span>•</span>
            <span>{it.size_sqm ? `${it.size_sqm} sqm` : 'Size N/A'}</span>
            <span>•</span>
            <span>{it.property_type}</span>
          </div>
          <div className="meta" style={{marginTop:8}}>
            <span>Price/sqm: {it.price_per_sqm ? formatMoney(it.price_per_sqm) : '—'}</span>
            <span>•</span>
            <span>Market: {it.market_avg_price_per_sqm ? formatMoney(it.market_avg_price_per_sqm) : '—'}</span>
            <span>•</span>
            <span>% vs market: {it.pct_vs_market ?? '—'}%</span>
          </div>
          <div style={{marginTop:10}}>
            <a className="button secondary" href={it.url} target="_blank" rel="noreferrer">Open Listing</a>
          </div>
        </article>
      ))}
    </div>
  );
}
