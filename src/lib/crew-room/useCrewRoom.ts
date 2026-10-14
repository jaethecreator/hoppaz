'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';
import type { CampaignContent } from '@/lib/campaign/layout';
import type { Tile } from '@/lib/campaign/geometry';
import type { CrewRoomConnection, PositionReset, RoomMessage, RoomSnapshot } from './types';

const MESSAGE_COLUMNS = 'id,crew_id,author_id,author_name,author_look,body,scope,circle_id,created_at';
const entries = new WeakMap<SupabaseClient, Map<string, Promise<void>>>();
function explain(message = '') {
  if (message.includes('not_in_crew')) return 'Join this crew to enter its room.';
  if (message.includes('need_account')) return 'Sign in to enter your crew room.';
  if (message.includes('room_session_expired')) return 'Your room session ended or opened in another tab. Rejoin to continue.';
  if (message.includes('conversation_changed')) return 'You left that conversation area. Return to it before sending.';
  if (message.includes('slow_down')) return 'Give the conversation a moment, then try again.';
  if (message.includes('owner_only')) return 'Only the crew owner can change this room.';
  if (/PGRST202|function.*does not exist/.test(message)) return 'Crew rooms are not installed on this database yet.';
  return 'The room could not connect. Your message has been kept so you can retry.';
}

/** Server-checked steps and message audiences. No client broadcast carries private text or decides membership. */
export function useCrewRoom(crewId: string, userId: string | null, client?: SupabaseClient): CrewRoomConnection {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [status, setStatus] = useState<CrewRoomConnection['status']>('loading');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [reset, setReset] = useState<PositionReset>({ x: 15, y: 17, revision: 0 });
  const [attempt, setAttempt] = useState(0);
  const queue = useRef<Tile[]>([]);
  const active = useRef(false);
  const acceptSteps = useRef(false);
  const sequence = useRef(0);
  const version = useRef(0);
  const current = useRef<RoomSnapshot | null>(null);
  const batch = useRef<{ steps: Tile[]; seq: number } | null>(null);
  const refreshMessages = useRef<() => Promise<void>>(async () => {});
  const applySnapshot = useRef<(data: RoomSnapshot, force?: boolean) => void>(() => {});
  const pendingSend = useRef<{ scope: string; text: string; circle: string | null; id: string } | null>(null);

  useEffect(() => {
    const sb = client ?? getSupabase();
    if (!sb || !userId) { setStatus('error'); setError('Sign in to enter your crew room.'); return; }
    let stopped = false, flushing = false, reading = false, messagesLoading = false, entered = false;
    let lastRead = 0, lastBeat = 0, retryAt = 0;
    const sessionId = crypto.randomUUID();
    active.current = false; acceptSteps.current = false; queue.current = []; batch.current = null; version.current = 0; sequence.current = 0;
    current.current = null; setSnapshot(null); setMessages([]); setStatus('loading'); setError('');
    const apply = (data: RoomSnapshot, force = false) => {
      if (stopped || !data?.self || data.room.version < version.current) return;
      if (!force && current.current && data.observed_at < current.current.observed_at) return;
      if (data.self.session_id !== sessionId) {
        active.current = false; acceptSteps.current = false; setStatus('error'); setError(explain('room_session_expired')); return;
      }
      const changed = version.current !== data.room.version;
      if (changed || force) {
        queue.current = []; batch.current = null; sequence.current = data.self.seq;
        setReset((old) => ({ x: data.self!.x, y: data.self!.y, revision: old.revision + 1 }));
      }
      version.current = data.room.version; current.current = data; setSnapshot(data);
    };
    applySnapshot.current = apply;
    const loadMessages = async () => {
      if (stopped || messagesLoading) return;
      messagesLoading = true;
      try {
        const { data, error: problem } = await sb.from('crew_room_messages').select(MESSAGE_COLUMNS).eq('crew_id', crewId).order('created_at', { ascending: false }).limit(120);
        if (!stopped && !problem && data) setMessages((data as RoomMessage[]).slice().reverse());
      } catch { /* A later catch-up read restores the same authorised feed. */ }
      finally { messagesLoading = false; }
    };
    refreshMessages.current = loadMessages;
    const read = async () => {
      if (stopped || reading || !active.current) return;
      reading = true;
      try {
        const { data, error: problem } = await sb.rpc('crew_room_state', { p_crew: crewId });
        if (stopped) return;
        if (problem) {
          if (/not_in_crew|need_account/.test(problem.message)) { active.current = false; setStatus('error'); setError(explain(problem.message)); }
          return;
        }
        if (data) apply(data as RoomSnapshot);
      } catch { /* The heartbeat determines connectivity; the next read catches up. */ }
      finally { reading = false; }
    };
    const flush = async () => {
      if (stopped || flushing || !active.current || Date.now() < retryAt) return;
      if (!batch.current && !queue.current.length && Date.now()-lastBeat < 1000) return;
      flushing = true;
      if (!batch.current) batch.current = { steps: queue.current.slice(0,8), seq: sequence.current + (queue.current.length ? 1 : 0) };
      const request = batch.current;
      try {
        const { data, error: problem } = await sb.rpc('crew_room_step', { p_crew: crewId, p_session: sessionId, p_seq: request.seq, p_steps: request.steps });
        if (stopped) return;
        if (problem) {
          acceptSteps.current = false; setConnected(false);
          if (/room_session_expired|not_in_crew|need_account/.test(problem.message)) {
            active.current = false; setStatus('error'); setError(explain(problem.message));
          } else if (/invalid_movement|invalid_sequence|moving_too_fast/.test(problem.message)) {
            queue.current = []; batch.current = null;
            const result = await sb.rpc('crew_room_state', { p_crew: crewId });
            if (result.data) { apply(result.data as RoomSnapshot,true); acceptSteps.current = true; setConnected(true); }
          } else { retryAt = Date.now()+2000; }
          return;
        }
        if (batch.current === request) { queue.current.splice(0,request.steps.length); batch.current = null; }
        if ((data as RoomSnapshot).room.version >= version.current) sequence.current = (data as RoomSnapshot).self?.seq ?? request.seq;
        apply(data as RoomSnapshot); lastBeat = Date.now(); acceptSteps.current = true; setConnected(true);
      } catch { acceptSteps.current = false; setConnected(false); retryAt = Date.now()+2000; }
      finally { flushing = false; }
    };
    const pendingEntries = entries.get(sb) ?? new Map<string, Promise<void>>();
    entries.set(sb,pendingEntries);
    // Strict Mode and quick route changes can overlap entry requests. Finish an old
    // entry (and its matching leave) before a fresh session takes ownership.
    const entry = (pendingEntries.get(crewId) ?? Promise.resolve()).then(async () => {
      if (stopped) return;
      try {
        const { data, error: problem } = await sb.rpc('crew_room_enter', { p_crew: crewId, p_session: sessionId });
        if (stopped) { if (data && !problem) await sb.rpc('crew_room_leave',{p_crew:crewId,p_session:sessionId}); return; }
        if (problem || !data) { setError(explain(problem?.message)); setStatus('error'); return; }
        entered = true;
        active.current = true; acceptSteps.current = true; setConnected(true); apply(data as RoomSnapshot,true); setStatus('ready');
        await loadMessages();
      } catch { if (!stopped) { setError('The room could not connect. Try joining again.'); setStatus('error'); } }
    });
    pendingEntries.set(crewId,entry);
    void entry.then(() => { if (pendingEntries.get(crewId)===entry) pendingEntries.delete(crewId); });
    const channel = sb.channel(`crew-room:${crewId}:${sessionId}`)
      .on('postgres_changes', { event:'INSERT',schema:'public',table:'crew_room_messages',filter:`crew_id=eq.${crewId}` }, () => void loadMessages())
      .on('postgres_changes', { event:'UPDATE',schema:'public',table:'crew_rooms',filter:`crew_id=eq.${crewId}` }, () => void read())
      .subscribe();
    // Presence is refreshed independently of chat transport; polling also recovers missed reconnect events.
    const clock = setInterval(() => {
      void flush();
      if (Date.now()-lastRead > 1200) { lastRead = Date.now(); void read(); }
    }, 200);
    const catchup = setInterval(() => void loadMessages(), 3000);
    return () => {
      stopped = true; active.current = false; acceptSteps.current = false;
      clearInterval(clock); clearInterval(catchup); void sb.removeChannel(channel);
      if (entered) void sb.rpc('crew_room_leave', { p_crew:crewId,p_session:sessionId }).then(() => {});
    };
  }, [crewId,userId,attempt,client]);

  const onStep = useCallback((tile: Tile) => {
    if (!acceptSteps.current || queue.current.length >= 8) return false;
    queue.current.push(tile); return true;
  }, []);
  const send = useCallback(async (scope: 'general' | 'nearby', text: string, circle: string | null) => {
    const sb = client ?? getSupabase();
    if (!sb || !active.current || !acceptSteps.current) return 'The room is reconnecting. Your message is still here.';
    if (scope==='nearby' && (queue.current.length || batch.current?.steps.length)) return 'Finishing your move. Send once your position has updated.';
    const previous = pendingSend.current;
    const request = previous?.scope===scope && previous.text===text && previous.circle===circle ? previous : { scope,text,circle,id:crypto.randomUUID() };
    pendingSend.current = request;
    const { error: problem } = await sb.rpc('crew_room_send', { p_crew:crewId,p_scope:scope,p_body:text,p_request:request.id,p_circle:circle });
    if (problem) return explain(problem.message);
    pendingSend.current = null; await refreshMessages.current(); return null;
  }, [crewId,client]);
  const save = useCallback(async (width: 30 | 36, content: CampaignContent) => {
    const sb = client ?? getSupabase();
    if (!sb) return 'The room is offline. Try again when connected.';
    const { data, error: problem } = await sb.rpc('crew_room_settings', { p_crew:crewId,p_width:width,p_content:content });
    if (problem) return explain(problem.message);
    if (data) applySnapshot.current(data as RoomSnapshot);
    return null;
  }, [crewId,client]);
  const retry = useCallback(() => setAttempt((value) => value+1), []);
  return { snapshot,messages,status,error,connected,retry,send,save,
    world: snapshot && userId ? { peers:snapshot.peers,circles:snapshot.circles,selfId:userId,circleId:snapshot.self?.circle_id ?? null,areaId:snapshot.circles.find((circle) => circle.id===snapshot.self?.circle_id)?.area_id ?? null,reset,onStep } : null };
}
