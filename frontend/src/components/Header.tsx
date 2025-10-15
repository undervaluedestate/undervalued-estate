import React from 'react';
import Logo from './Logo';

type HeaderProps = {
  session?: boolean;
  isAdmin?: boolean;
  onLogout?: () => Promise<void> | void;
};

export default function Header({ session, isAdmin, onLogout }: HeaderProps): React.ReactElement {
  return (
    <header className="header">
      <div className="logo">
        <Logo size={36} className="logo-mark" />
        <div>
          <div style={{fontSize:16, opacity:.8}}>Undervalued</div>
          <div style={{fontSize:18, fontWeight:800, letterSpacing:.3}}>ESTATE</div>
        </div>
      </div>
      <nav className="meta" style={{gap:16 as number}}>
        <a href="#deals" className="badge" style={{textDecoration:'none', color:'inherit'}}>Deals</a>
        <a href="#benchmarks" className="badge" style={{textDecoration:'none', color:'inherit'}}>Clusters</a>
        {session && <a href="#support" className="badge" style={{textDecoration:'none', color:'inherit'}}>Support</a>}
        {isAdmin && <a href="#admin" className="badge" style={{textDecoration:'none', color:'inherit'}}>Admin</a>}
        {!session ? (
          <a href="#login" className="badge" style={{textDecoration:'none', color:'inherit'}}>Login</a>
        ) : (
          <button className="badge" onClick={() => { if (onLogout) onLogout(); }} style={{background:'transparent', border:'1px solid rgba(255,255,255,.2)', cursor:'pointer'}}>Logout</button>
        )}
      </nav>
    </header>
  );
}
