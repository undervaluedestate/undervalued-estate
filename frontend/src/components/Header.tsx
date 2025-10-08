import React from 'react';

export default function Header(): React.ReactElement {
  return (
    <header className="header">
      <div className="logo">
        <div className="logo-badge">UE</div>
        <div>
          <div style={{fontSize:16, opacity:.8}}>Undervalued</div>
          <div style={{fontSize:18, fontWeight:800, letterSpacing:.3}}>ESTATE</div>
        </div>
      </div>
      <nav className="meta" style={{gap:16 as number}}>
        <a href="#deals" className="badge" style={{textDecoration:'none', color:'inherit'}}>Deals</a>
        <a href="#benchmarks" className="badge" style={{textDecoration:'none', color:'inherit'}}>Benchmarks</a>
        <a href="#alerts" className="badge" style={{textDecoration:'none', color:'inherit'}}>Alerts</a>
      </nav>
    </header>
  );
}
