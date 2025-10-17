import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

type Props = { session: any; isAdmin?: boolean };

export default function Admin({ session, isAdmin }: Props) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [otherTyping, setOtherTyping] = useState(false);
  const channelRef = useRef<any>(null);
  const [filterMode, setFilterMode] = useState<'all'|'unread'|'waiting'|'has_property'>('all');
  const [search, setSearch] = useState('');
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const [lastFromMap, setLastFromMap] = useState<Record<string, 'user'|'admin'>>({});
  const [hasPropertySet, setHasPropertySet] = useState<Set<string>>(new Set());

  const adminId = session?.user?.id || null;

  useEffect(() => {
    (async () => {
      if (!supabase || !isAdmin) return;
      const client = supabase;
      try {
        setLoading(true); setError('');
        const { data, error } = await client
          .from('support_conversations')
          .select('*')
          .order('updated_at', { ascending: false });
        if (error) throw error;
        setConversations(data || []);
        if (data && data.length && !selectedId) setSelectedId(data[0].id);
      } catch (e: any) {
        setError(e?.message || 'Failed to load conversations');
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  useEffect(() => {
    if (!supabase || !isAdmin) return;
    const client = supabase;
    const chConv = client.channel('support:conv:list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setConversations(prev => [payload.new, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setConversations(prev => prev.map(c => c.id === (payload.new as any).id ? payload.new : c));
        } else if (payload.eventType === 'DELETE') {
          setConversations(prev => prev.filter(c => c.id !== (payload.old as any).id));
        }
      })
      .subscribe();
    return () => { client.removeChannel(chConv); };
  }, [isAdmin]);

  useEffect(() => {
    (async () => {
      if (!supabase || !selectedId || !isAdmin) { setMessages([]); return; }
      const client = supabase;
      const { data } = await client
        .from('support_messages')
        .select('*')
        .eq('conversation_id', selectedId)
        .order('created_at', { ascending: true });
      setMessages(data || []);
    })();
  }, [selectedId, isAdmin]);

  useEffect(() => {
    if (!supabase || !selectedId || !isAdmin) return;
    const client = supabase;
    const ch = client.channel(`support:conv:${selectedId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${selectedId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setMessages(prev => [...prev, payload.new]);
        } else if (payload.eventType === 'UPDATE') {
          setMessages(prev => prev.map(m => m.id === (payload.new as any).id ? payload.new : m));
        } else if (payload.eventType === 'DELETE') {
          setMessages(prev => prev.filter(m => m.id !== (payload.old as any).id));
        }
      })
      .on('broadcast', { event: 'typing' }, (payload: any) => {
        if (payload?.payload?.from === 'user') {
          setOtherTyping(true);
          setTimeout(()=> setOtherTyping(false), 1500);
        }
      })
      .subscribe();
    channelRef.current = ch;
    return () => { client.removeChannel(ch); };
  }, [selectedId, isAdmin]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  // When viewing a conversation, mark user's messages as read
  useEffect(() => {
    (async () => {
      if (!supabase || !selectedId || !isAdmin) return;
      await supabase.from('support_messages')
        .update({ read_at: new Date().toISOString() })
        .is('read_at', null)
        .eq('conversation_id', selectedId)
        .eq('from_role', 'user');
    })();
  }, [selectedId, messages.length, isAdmin]);

  async function sendMessage() {
    if (!supabase || !selectedId || !adminId) return;
    const client = supabase;
    const text = body.trim();
    if (!text) return;
    setBody('');
    const { data: ins, error: insErr } = await client.from('support_messages').insert({
      conversation_id: selectedId,
      from_role: 'admin',
      sender_id: adminId,
      body: text,
    }).select('id').single();
    if (insErr) return;
    try {
      const API_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
      await fetch(`${API_URL}/api/support/notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message_id: ins?.id }),
      });
      setToast('Reply sent');
      setTimeout(()=>setToast(''), 2500);
    } catch {}
  }

  // Fetch conversation meta for filters
  useEffect(() => {
    (async () => {
      if (!supabase || !isAdmin || conversations.length === 0) return;
      const ids = conversations.map(c => c.id);
      // Unread map for user messages
      const { data: unreadRows } = await supabase
        .from('support_messages')
        .select('conversation_id')
        .is('read_at', null)
        .eq('from_role', 'user')
        .in('conversation_id', ids as any);
      const uMap: Record<string, number> = {};
      (unreadRows || []).forEach((r: any) => { uMap[r.conversation_id] = (uMap[r.conversation_id] || 0) + 1; });
      setUnreadMap(uMap);

      // Last from map
      const { data: lastRows } = await supabase
        .from('support_messages')
        .select('conversation_id, from_role, created_at')
        .in('conversation_id', ids as any)
        .order('created_at', { ascending: false })
        .limit(1000);
      const lMap: Record<string, 'user'|'admin'> = {};
      (lastRows || []).forEach((m: any) => { if (!(m.conversation_id in lMap)) lMap[m.conversation_id] = m.from_role; });
      setLastFromMap(lMap);

      // Has property set
      const { data: propRows } = await supabase
        .from('support_messages')
        .select('conversation_id')
        .not('property_snapshot', 'is', null)
        .in('conversation_id', ids as any)
        .limit(1000);
      setHasPropertySet(new Set((propRows || []).map((r: any) => r.conversation_id)));
    })();
  }, [conversations.length, isAdmin]);

  const filteredConversations = useMemo(() => {
    let arr = conversations;
    if (search) {
      const q = search.toLowerCase();
      arr = arr.filter(c => String(c.user_id).toLowerCase().includes(q));
    }
    if (filterMode === 'unread') {
      arr = arr.filter(c => (unreadMap[c.id] || 0) > 0);
    } else if (filterMode === 'waiting') {
      arr = arr.filter(c => lastFromMap[c.id] === 'user');
    } else if (filterMode === 'has_property') {
      arr = arr.filter(c => hasPropertySet.has(c.id));
    }
    return arr;
  }, [conversations, unreadMap, lastFromMap, hasPropertySet, filterMode, search]);

  const lastMineId = useMemo(() => {
    const mine = messages.filter(m => m.from_role === 'admin');
    return mine.length ? mine[mine.length - 1].id : null;
  }, [messages]);

  if (!isAdmin) return (
    <div className="card">Only admins can view this page.</div>
  );

  return (
    <div className="card admin-grid" style={{display:'grid', gridTemplateColumns:'260px 1fr', gap:12}}>
      <div className="admin-sidebar" style={{borderRight: '1px solid var(--border)', paddingRight: 8}}>
        <div style={{fontWeight:700, marginBottom:8}}>Conversations</div>
        <div className="meta" style={{gap:8, marginBottom:8}}>
          <div className="segmented">
            <button className={`seg ${filterMode==='all'?'active':''}`} onClick={()=>setFilterMode('all')}>All</button>
            <button className={`seg ${filterMode==='unread'?'active':''}`} onClick={()=>setFilterMode('unread')}>Unread</button>
            <button className={`seg ${filterMode==='waiting'?'active':''}`} onClick={()=>setFilterMode('waiting')}>Waiting</button>
            <button className={`seg ${filterMode==='has_property'?'active':''}`} onClick={()=>setFilterMode('has_property')}>Has property</button>
          </div>
        </div>
        <input className="input" placeholder="Search by user id…" value={search} onChange={e=>setSearch(e.target.value)} />
        {loading && <div>Loading…</div>}
        {error && <div style={{color:'#ef4444'}}>Error: {error}</div>}
        <div style={{display:'flex', flexDirection:'column', gap:6}}>
          {filteredConversations.map(c => (
            <button key={c.id} className={`badge ${selectedId===c.id ? 'active' : ''}`} onClick={()=> setSelectedId(c.id)} style={{justifyContent:'flex-start', display:'flex', alignItems:'center', gap:8}}>
              <div style={{display:'flex', flexDirection:'column', alignItems:'flex-start'}}>
                <div style={{fontWeight:600}}>User {String(c.user_id).slice(0, 8)}…</div>
                <div style={{opacity:.7, fontSize:12}}>{new Date(c.updated_at).toLocaleString()}</div>
              </div>
              {(unreadMap[c.id]||0)>0 && <span className="badge" style={{background:'rgba(239,68,68,.15)', borderColor:'#ef4444', color:'#ef4444'}}>{unreadMap[c.id]}</span>}
              {lastFromMap[c.id]==='user' && <span className="badge" style={{background:'rgba(56,189,248,.15)', borderColor:'var(--brand)', color:'var(--brand)'}}>waiting</span>}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
          <div style={{fontWeight:700}}>Conversation</div>
          <button className="badge show-mobile" onClick={()=>setDrawerOpen(true)}>Conversations</button>
        </div>
        <div ref={listRef} style={{maxHeight: 520, overflowY:'auto', padding:8, border:'1px solid var(--border-soft)', borderRadius:6}}>
          {messages.length === 0 && <div style={{opacity:.7}}>No messages yet.</div>}
          {messages.map(m => {
            const mine = m.from_role === 'admin';
            return (
              <div key={m.id} style={{display:'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 6}}>
                <div style={{maxWidth: '70%', padding: '8px 10px', borderRadius: 8, background: mine ? 'rgba(59,130,246,.2)' : 'var(--bubble-other)'}}>
                  <div style={{whiteSpace: 'pre-wrap'}}>{m.body}</div>
                  <div style={{opacity:.6, fontSize: 11, marginTop: 4}}>{new Date(m.created_at).toLocaleString()}</div>
                  {mine && m.id === lastMineId && m.read_at && (
                    <div style={{opacity:.7, fontSize:11, marginTop:2}}>Seen</div>
                  )}
                  {m.property_snapshot && (
                    <div style={{marginTop:8, padding:8, border:'1px solid var(--border-strong)', borderRadius:6, background:'var(--panel-subtle)'}}>
                      <div style={{fontWeight:600, marginBottom:4}}>{m.property_snapshot.title || 'Listing'}</div>
                      <div className="meta" style={{gap:8}}>
                        {m.property_snapshot.price != null && <span>Price: {m.property_snapshot.currency ? new Intl.NumberFormat('en-GB',{style:'currency', currency: String(m.property_snapshot.currency).toUpperCase()}).format(Number(m.property_snapshot.price)) : m.property_snapshot.price}</span>}
                        <span>•</span>
                        {m.property_snapshot.property_type && <span>Type: {m.property_snapshot.property_type}</span>}
                        {m.property_snapshot.bedrooms != null && <span>• Beds: {m.property_snapshot.bedrooms}</span>}
                        {m.property_snapshot.bathrooms != null && <span>• Baths: {m.property_snapshot.bathrooms}</span>}
                      </div>
                      {m.property_snapshot.url && <div style={{marginTop:6}}><a className="badge" href={m.property_snapshot.url} target="_blank" rel="noreferrer">Open Listing</a></div>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {otherTyping && <div className="meta" style={{opacity:.7, fontSize:12, marginTop:6}}>User is typing…</div>}
        <div className="meta" style={{marginTop:8}}>
          <textarea placeholder="Type a reply…" value={body} onChange={e=>{ setBody(e.target.value); const ch:any = channelRef.current; if (ch && e.target.value) { ch.send({ type:'broadcast', event:'typing', payload:{ from:'admin' } }); } }} rows={2} style={{flex:1}} />
          <button className="badge" onClick={sendMessage}>Send</button>
        </div>
      </div>
      {drawerOpen && (
        <div className="drawer" onClick={()=>setDrawerOpen(false)}>
          <div className="drawer-inner" onClick={(e)=>e.stopPropagation()}>
            <div style={{fontWeight:700, marginBottom:8}}>Conversations</div>
            {loading && <div>Loading…</div>}
            {error && <div style={{color:'#ef4444'}}>Error: {error}</div>}
            <div style={{display:'flex', flexDirection:'column', gap:6}}>
              {conversations.map(c => (
                <button key={c.id} className={`badge ${selectedId===c.id ? 'active' : ''}`} onClick={()=> { setSelectedId(c.id); setDrawerOpen(false); }} style={{justifyContent:'flex-start'}}>
                  <div style={{display:'flex', flexDirection:'column', alignItems:'flex-start'}}>
                    <div style={{fontWeight:600}}>User {String(c.user_id).slice(0, 8)}…</div>
                    <div style={{opacity:.7, fontSize:12}}>{new Date(c.updated_at).toLocaleString()}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {!!toast && (
        <div className="toast">{toast}</div>
      )}
    </div>
  );
}
