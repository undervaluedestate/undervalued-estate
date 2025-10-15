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
        } else if (payload.eventType === 'UPDATE') {
          setMessages(prev => prev.map(m => m.id === (payload.new as any).id ? payload.new : m));
        } else if (payload.eventType === 'DELETE') {
          setMessages(prev => prev.filter(m => m.id !== (payload.old as any).id));
        }
      })
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [conversationId]);

  useEffect(() => {
    // autoscroll
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  async function sendMessage() {
    try {
      if (!supabase || !conversationId || !userId) return;
      const client = supabase;
      const text = body.trim();
      if (!text) return;
      setBody('');
      await client.from('support_messages').insert({
        conversation_id: conversationId,
        from_role: 'user',
        sender_id: userId,
        body: text,
      });
    } catch (e) {
      // ignore for now
    }
  }

  const isAuthed = !!userId;

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
          <div ref={listRef} style={{maxHeight: 420, overflowY: 'auto', padding: 8, border: '1px solid rgba(255,255,255,.1)', borderRadius: 6}}>
            {messages.length === 0 && <div style={{opacity:.7}}>Start a conversation with us — we usually reply instantly.</div>}
            {messages.map((m) => {
              const mine = m.from_role === 'user';
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
          <div className="meta" style={{marginTop: 8}}>
            <textarea placeholder="Type a message…" value={body} onChange={e => setBody(e.target.value)} rows={2} style={{flex:1}} />
            <button className="badge" onClick={sendMessage}>Send</button>
          </div>
        </>
      )}
    </div>
  );
}
