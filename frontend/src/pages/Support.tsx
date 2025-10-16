import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

type Props = { session: any };

export default function Support({ session }: Props) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const listRef = useRef<HTMLDivElement>(null);
  const [otherTyping, setOtherTyping] = useState<boolean>(false);
  const typingTimeoutRef = useRef<any>(null);
  const channelRef = useRef<any>(null);

  const userId = session?.user?.id || null;

  // Ensure conversation exists and load messages
  useEffect(() => {
    (async () => {
      if (!supabase || !userId) { setLoading(false); return; }
      const client = supabase;
      setLoading(true); setError('');
      try {
        let convId: string | null = null;
        const { data: conv } = await client
          .from('support_conversations')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();
        if (conv?.id) {
          convId = conv.id as string;
        } else {
          const { data: created, error: insErr } = await client
            .from('support_conversations')
            .insert({ user_id: userId })
            .select('*')
            .single();
          if (insErr) throw insErr;
          convId = created.id as string;
        }
        setConversationId(convId);
        const { data: msgs } = await client
          .from('support_messages')
          .select('*')
          .eq('conversation_id', convId!)
          .order('created_at', { ascending: true });
        setMessages(msgs || []);
      } catch (e: any) {
        setError(e?.message || 'Failed to load conversation');
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  // Realtime subscription
  useEffect(() => {
    if (!supabase || !conversationId) return;
    const client = supabase;
    const channel = client.channel(`support:conv:${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setMessages(prev => [...prev, payload.new]);
          // If incoming message is from admin, mark read now that user is viewing
          const m: any = payload.new;
          if (m.from_role === 'admin') {
            client.from('support_messages')
              .update({ read_at: new Date().toISOString() })
              .is('read_at', null)
              .eq('id', m.id)
              .then(()=>{});
          }
        } else if (payload.eventType === 'UPDATE') {
          setMessages(prev => prev.map(m => m.id === (payload.new as any).id ? payload.new : m));
        } else if (payload.eventType === 'DELETE') {
          setMessages(prev => prev.filter(m => m.id !== (payload.old as any).id));
        }
      })
      .on('broadcast', { event: 'typing' }, (payload: any) => {
        if (payload?.payload?.from === 'admin') {
          setOtherTyping(true);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setOtherTyping(false), 2000);
        }
      })
      .subscribe();
    channelRef.current = channel;
    return () => { client.removeChannel(channel); };
  }, [conversationId]);

  useEffect(() => {
    // autoscroll
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  // Mark admin messages as read when we load them
  useEffect(() => {
    (async () => {
      if (!supabase || !conversationId || !userId) return;
      await supabase.from('support_messages')
        .update({ read_at: new Date().toISOString() })
        .is('read_at', null)
        .eq('conversation_id', conversationId)
        .eq('from_role', 'admin');
    })();
  }, [conversationId, messages.length]);

  async function sendMessage() {
    try {
      if (!supabase || !conversationId || !userId) return;
      const client = supabase;
      const text = body.trim();
      if (!text) return;
      setBody('');
      const { data: ins, error: insErr } = await client.from('support_messages').insert({
        conversation_id: conversationId,
        from_role: 'user',
        sender_id: userId,
        body: text,
      }).select('id').single();
      if (!insErr) {
        try {
          const API_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
          await fetch(`${API_URL}/api/support/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message_id: ins?.id }),
          });
        } catch {}
      }
    } catch (e) {
      // ignore for now
    }
  }

  const isAuthed = !!userId;
  const lastMineId = useMemo(() => {
    const mine = messages.filter(m => m.from_role === 'user');
    return mine.length ? mine[mine.length - 1].id : null;
  }, [messages]);

  return (
    <div className="card" style={{maxWidth: 820, margin: '0 auto'}}>
      <div className="meta" style={{justifyContent:'space-between', marginBottom: 8}}>
        <div style={{fontWeight:700}}>Support</div>
        {!isAuthed && <div style={{opacity:.8}}>Please <a href="#login">log in</a> to chat.</div>}
      </div>
      {loading && <div>Loading chat…</div>}
      {error && <div style={{color:'#ef4444'}}>Error: {error}</div>}
      {isAuthed && (
        <>
          <div ref={listRef} style={{maxHeight: '60vh', overflowY: 'auto', padding: 8, border: '1px solid rgba(255,255,255,.1)', borderRadius: 6}}>
            {messages.length === 0 && <div style={{opacity:.7}}>Start a conversation with us — we usually reply instantly.</div>}
            {messages.map((m) => {
              const mine = m.from_role === 'user';
              return (
                <div key={m.id} style={{display:'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 6}}>
                  <div style={{maxWidth: '70%', padding: '8px 10px', borderRadius: 8, background: mine ? 'rgba(59,130,246,.2)' : 'rgba(255,255,255,.06)'}}>
                    <div style={{whiteSpace: 'pre-wrap'}}>{m.body}</div>
                    <div style={{opacity:.6, fontSize: 11, marginTop: 4}}>{new Date(m.created_at).toLocaleString()}</div>
                    {mine && m.id === lastMineId && m.read_at && (
                      <div style={{opacity:.7, fontSize:11, marginTop:2}}>Seen</div>
                    )}
                    {m.property_snapshot && (
                      <div style={{marginTop:8, padding:8, border:'1px solid rgba(255,255,255,.12)', borderRadius:6, background:'rgba(255,255,255,.03)'}}>
                        <div style={{fontWeight:600, marginBottom:4}}>{m.property_snapshot.title || 'Listing'}</div>
                        <div className="meta" style={{gap:8}}>
                          {m.property_snapshot.price != null && <span>Price: {m.property_snapshot.currency ? new Intl.NumberFormat('en-GB',{style:'currency', currency: String(m.property_snapshot.currency).toUpperCase()}).format(Number(m.property_snapshot.price)) : m.property_snapshot.price}</span>}
                          <span>•</span>
                          {m.property_snapshot.property_type && <span>Type: {m.property_snapshot.property_type}</span>}
                          {m.property_snapshot.bedrooms != null && <span>• Beds: {m.property_snapshot.bedrooms}</span>}
                          {m.property_snapshot.bathrooms != null && <span>• Baths: {m.property_snapshot.bathrooms}</span>}
                        </div>
                        {m.property_snapshot.images && m.property_snapshot.images.length > 0 && (
                          <div style={{display:'flex', gap:8, marginTop:6}}>
                            {m.property_snapshot.images.slice(0,3).map((u: string) => (
                              <img key={u} src={u} alt="Listing" style={{width:72, height:72, objectFit:'cover', borderRadius:6, border:'1px solid rgba(255,255,255,.08)'}} />
                            ))}
                          </div>
                        )}
                        {m.property_snapshot.url && <div style={{marginTop:6}}><a className="badge" href={m.property_snapshot.url} target="_blank" rel="noreferrer">Open Listing</a></div>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {otherTyping && <div className="meta" style={{opacity:.7, fontSize:12, marginTop:6}}>Support is typing…</div>}
          <div className="meta" style={{marginTop: 8, position:'sticky', bottom:8, background:'transparent', paddingTop:8}}>
            <textarea placeholder="Type a message…" value={body} onChange={e => {
              setBody(e.target.value);
              const ch: any = channelRef.current;
              if (ch && e.target.value) {
                ch.send({ type: 'broadcast', event: 'typing', payload: { from: 'user' } });
              }
            }} rows={2} style={{flex:1}} />
            <button className="badge" onClick={sendMessage}>Send</button>
          </div>
        </>
      )}
    </div>
  );
}
