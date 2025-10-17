import React from 'react';

export type FiltersValue = {
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

export default function Filters({ value, onChange, onSearch }: {
  value: FiltersValue;
  onChange: (v: FiltersValue) => void;
  onSearch: () => void;
}): React.ReactElement {
  function set<K extends keyof FiltersValue>(k: K, v: FiltersValue[K]){
    onChange({ ...value, [k]: v } as FiltersValue);
  }
  return (
    <div>
      <div className="filters">
        <input className="input" placeholder="Search keywords (e.g., Lagos, duplex)" value={value.q} onChange={e=>set('q', e.target.value)} />
        <select className="select" value={value.country} onChange={e=>{ const v = e.target.value; set('country', v); try{ window.localStorage?.setItem('ud_country_pref', v); }catch{} }}>
          <option value="">Any country</option>
          <option value="Nigeria">Nigeria</option>
          <option value="United Kingdom">United Kingdom</option>
        </select>
        <input className="input" placeholder="State" value={value.state} onChange={e=>set('state', e.target.value)} />
        <input className="input" placeholder="City" value={value.city} onChange={e=>set('city', e.target.value)} />
        <input className="input" placeholder="Neighborhood" value={value.neighborhood} onChange={e=>set('neighborhood', e.target.value)} />
        
        <select className="select" value={value.property_type} onChange={e=>set('property_type', e.target.value)}>
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

        <select className="select" value={value.currency} onChange={e=>set('currency', e.target.value)}>
          <option value="">Any currency</option>
          <option value="NGN">NGN</option>
          <option value="GBP">GBP</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </select>
        <input className="input" placeholder="Bedrooms" value={value.bedrooms} onChange={e=>set('bedrooms', e.target.value)} />
        <input className="input" placeholder="Bathrooms" value={value.bathrooms} onChange={e=>set('bathrooms', e.target.value)} />

        <input className="input" placeholder="Min price (NGN)" value={value.min_price} onChange={e=>set('min_price', e.target.value)} />
        <input className="input" placeholder="Max price (NGN)" value={value.max_price} onChange={e=>set('max_price', e.target.value)} />
        <input className="input" placeholder="Min size (sqm)" value={value.min_size_sqm} onChange={e=>set('min_size_sqm', e.target.value)} />
        <input className="input" placeholder="Max size (sqm)" value={value.max_size_sqm} onChange={e=>set('max_size_sqm', e.target.value)} />
        <input className="input" placeholder="Min % below market" value={value.min_pct_below} onChange={e=>set('min_pct_below', e.target.value)} />

        <select className="select" value={value.deal_type} onChange={e=>set('deal_type', e.target.value)}>
          <option value="">Any deal type</option>
          <option value="slightly_undervalued">Slightly undervalued</option>
          <option value="strongly_undervalued">Strongly undervalued</option>
          <option value="rare_deal">Rare deal</option>
        </select>
      </div>
      <div className="actions">
        <button className="button" onClick={onSearch}>Search deals</button>
        <button className="button secondary" onClick={()=>onChange({ ...value, q:'', country:'', state:'', city:'', neighborhood:'', property_type:'', currency:'', bedrooms:'', bathrooms:'', min_price:'', max_price:'', min_size_sqm:'', max_size_sqm:'', min_pct_below:'', deal_type:'', } as FiltersValue)}>Reset</button>
      </div>
    </div>
  );
}
