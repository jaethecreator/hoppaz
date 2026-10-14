'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, MessageCircle, X } from 'lucide-react';
import Bubble, { chatTime } from '@/components/chat/Bubble';
import ChatFace from '@/components/chat/ChatFace';
import { clubhouseWidth, privateAreaAt, type PrivateArea } from '@/lib/campaign/layout';
import type { CrewRoomConnection } from '@/lib/crew-room/types';
import css from './CrewRoom.module.css';

type Draft = { text: string; circle: string | null };
/** Each marked area keeps its own draft. Leaving never converts private text into general chat. */
export default function CrewRoomChat({ room, userId, open, onClose, mode, onMode, onVisit }: { room: CrewRoomConnection; userId: string; open: boolean; onClose: () => void; mode: 'general' | 'nearby'; onMode: (mode: 'general' | 'nearby') => void; onVisit: (area: PrivateArea) => void }) {
  const [general, setGeneral] = useState('');
  const [drafts, setDrafts] = useState<Record<string,Draft>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const feed = useRef<HTMLDivElement>(null);
  const layout = clubhouseWidth(room.snapshot?.room.width ?? 30);
  const circle = room.snapshot?.self?.circle_id ?? null;
  const area = layout.privateAreas.find((a) => a.id===room.world?.areaId) ?? null;
  const members = room.snapshot?.peers.filter((p) => circle && p.circle_id===circle) ?? [];
  const draft = area ? drafts[area.id] ?? {text:'',circle} : {text:'',circle:null};
  const messages = room.messages.filter((m) => m.scope===mode && (mode==='general' || (circle && m.circle_id===circle)));
  const text = mode==='general' ? general : draft.text;
  const changed = mode==='nearby' && !!draft.text && draft.circle!==circle;
  const unavailable = !room.connected || (mode==='nearby' && (!area || !circle || changed));
  const others = members.filter((p) => p.id!==userId);

  useEffect(() => { if (open && feed.current) feed.current.scrollTop=feed.current.scrollHeight; }, [open,messages.length,mode,circle]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending || unavailable || !text.trim()) return;
    setSending(true); setError('');
    const sendingArea = area?.id;
    try {
      const problem = await room.send(mode,text.trim(),mode==='nearby' ? draft.circle : null);
      if (problem) setError(problem);
      else if (mode==='general') setGeneral('');
      else if (sendingArea) setDrafts((old) => ({...old,[sendingArea]:{text:'',circle}}));
    } catch { setError('Could not send. Your message is still here; try again.'); }
    finally { setSending(false); }
  };
  return <section hidden={!open} className={css.chat} aria-label="Crew conversation" onKeyDown={(event) => { if (event.key==='Escape') { event.preventDefault();onClose(); } }}>
    <header className={css.chatHead}><MessageCircle size={18} className="text-orange" aria-hidden /><div><h2 className="font-display font-black">Crew chat</h2><p className="font-mono text-[10px] text-dim">{room.snapshot?.peers.length ?? 0} in the room</p></div><button type="button" onClick={onClose} aria-label="Close crew chat" className={css.close}><X size={19} aria-hidden /></button></header>
    <div className={css.modes} role="group" aria-label="Conversation audience"><button type="button" aria-pressed={mode==='general'} onClick={() => {onMode('general');setError('');}}>General</button><button type="button" aria-pressed={mode==='nearby'} onClick={() => {onMode('nearby');setError('');}}>Area chat {area && <span>{members.length}</span>}</button></div>
    <div className={css.audience} role="status">{mode==='general' ? 'Everyone in this crew can read and reply.' : area ? <><strong>{area.name}</strong><span>{others.length ? `With ${others.slice(0,3).map((p) => p.name).join(', ')}${others.length>3 ? ` and ${others.length-3} others` : ''}.` : 'You’re the first here.'} Only people inside this boundary receive new messages.</span></> : 'Walk into a marked area to join its conversation. Your area drafts stay there.'}</div>
    <div className={css.feed} ref={feed} role="log" aria-label={mode==='general' ? 'General crew messages' : 'Private area messages'} aria-live="polite" aria-relevant="additions">
      {mode==='nearby' && !area ? <div className={css.areaList}>{layout.privateAreas.map((item) => {
        const count=room.snapshot?.peers.filter((p) => privateAreaAt(layout,p)?.id===item.id).length ?? 0;
        return <button type="button" key={item.id} onClick={() => {setError('');onVisit(item);}}><span><strong>{item.name}</strong><small>{count ? `${count} inside` : 'Be the first'}{drafts[item.id]?.text ? ' · Draft saved' : ''}</small></span><ArrowUpRight size={16} aria-hidden /></button>;
      })}<p className="hint">These areas are open to crew members. Walk in to join; walk out to leave.</p></div> : messages.length ? messages.map((message) => <div key={message.id} className={`${css.message} ${message.author_id===userId ? css.own : ''}`}><ChatFace look={message.author_look} size={28} /><Bubble body={message.body} author={message.author_id===userId ? 'You' : message.author_name} own={message.author_id===userId} time={chatTime(message.created_at)} /></div>) : <p className="hint">{mode==='general' ? 'Your crew’s conversation starts here.' : 'This area’s conversation starts here. Move around inside it; the conversation stays together.'}</p>}
    </div>
    <form className={css.composer} onSubmit={submit}>
      {changed && area && <div className={css.draftNotice}><p>A new conversation started here. Your draft is kept.</p><button type="button" onClick={() => setDrafts((old) => ({...old,[area.id]:{...draft,circle}}))}>Use this draft in this conversation</button></div>}
      {error && <p role="alert" className={css.error}>{error}</p>}
      {!room.connected && <p className="hint" role="status">Reconnecting. Your draft is kept.</p>}
      <div className={css.inputRow}><label className="sr-only" htmlFor="crew-room-message">{mode==='general' ? 'Message your crew' : 'Message this area'}</label><input id="crew-room-message" value={text} disabled={sending || (mode==='nearby' && !area)} maxLength={400} autoComplete="off" placeholder={mode==='general' ? 'Message your crew' : area ? `Message ${area.name}` : 'Choose an area above'} onChange={(event) => {
        const value=event.target.value;
        if (mode==='general') setGeneral(value);
        else if (area) setDrafts((old) => ({...old,[area.id]:{text:value,circle:draft.text ? draft.circle : circle}}));
      }} /><button type="submit" disabled={sending || unavailable || !text.trim()}>{sending ? 'Sending…' : 'Send'}</button></div>
    </form>
  </section>;
}
