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
    const ch = client.channel(`support:admin:${selectedId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${selectedId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setMessages(prev => [...prev, payload.new]);
        } else if (payload.eventType === 'UPDATE') {
          setMessages(prev => prev.map(m => m.id === (payload.new as any).id ? payload.new : m));
        } else if (payload.eventType === 'DELETE') {
          setMessages(prev => prev.filter(m => m.id !== (payload.old as any).id));
        }
      })
      .subscribe();
    return () => { client.removeChannel(ch); };
  }, [selectedId, isAdmin]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  async function sendMessage() {
    if (!supabase || !selectedId || !adminId) return;
    const client = supabase;
    const text = body.trim();
    if (!text) return;
    setBody('');
    await client.from('support_messages').insert({
      conversation_id: selectedId,
      from_role: 'admin',
      sender_id: adminId,
      body: text,
    });
  }

  if (!isAdmin) return (
    <div className="card">Only admins can view this page.</div>
  );

  return (
    <div className="card" style={{display:'grid', gridTemplateColumns:'260px 1fr', gap:12}}>
      <div style={{borderRight: '1px solid rgba(255,255,255,.06)', paddingRight: 8}}>
        <div style={{fontWeight:700, marginBottom:8}}>Conversations</div>
        {loading && <div>Loading…</div>}
        {error && <div style={{color:'#ef4444'}}>Error: {error}</div>}
        <div style={{display:'flex', flexDirection:'column', gap:6}}>
          {conversations.map(c => (
            <button key={c.id} className={`badge ${selectedId===c.id ? 'active' : ''}`} onClick={()=> setSelectedId(c.id)} style={{justifyContent:'flex-start'}}>
              <div style={{display:'flex', flexDirection:'column', alignItems:'flex-start'}}>
                <div style={{fontWeight:600}}>User {String(c.user_id).slice(0, 8)}…</div>
                <div style={{opacity:.7, fontSize:12}}>{new Date(c.updated_at).toLocaleString()}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div style={{fontWeight:700, marginBottom:8}}>Conversation</div>
        <div ref={listRef} style={{maxHeight: 520, overflowY:'auto', padding:8, border:'1px solid rgba(255,255,255,.1)', borderRadius:6}}>
          {messages.length === 0 && <div style={{opacity:.7}}>No messages yet.</div>}
          {messages.map(m => {
            const mine = m.from_role === 'admin';
            return (
              <div key={m.id} style={{display:'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 6}}>
                <div style={{maxWidth: '70%', padding: '8px 10px', borderRadius: 8, background: mine ? 'rgba(59,130,246,.2)' : 'rgba(255,255,255,.06)'}}>
                  <div style={{whiteSpace: 'pre-wrap'}}>{m.body}</div>
                  <div style={{opacity:.6, fontSize: 11, marginTop: 4}}>{new Date(m.created_at).toLocaleString()}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="meta" style={{marginTop:8}}>
          <textarea placeholder="Type a reply…" value={body} onChange={e=>setBody(e.target.value)} rows={2} style={{flex:1}} />
          <button className="badge" onClick={sendMessage}>Send</button>
        </div>
      </div>
    </div>
  );
}
