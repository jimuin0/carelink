'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import LoadError from '@/components/admin/LoadError';

interface ChatRoom {
  id: string;
  user_id: string;
  user_name: string;
  last_message_at: string;
  unread_count: number;
}

interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export default function AdminChatPage() {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [, setFacilityId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [messagesError, setMessagesError] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabaseRef = useRef(createBrowserSupabaseClient());

  const loadRooms = useCallback(async () => {
      const supabase = supabaseRef.current;
      setLoadError(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);

      const { data: membership, error: memErr } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
      if (memErr && memErr.code !== 'PGRST116') { setLoadError(true); setLoading(false); return; }
      if (!membership) { setLoading(false); return; }
      setFacilityId(membership.facility_id);

      const { data: roomsData, error: roomsError } = await supabase
        .from('chat_rooms')
        .select('id, user_id, last_message_at')
        .eq('facility_id', membership.facility_id)
        .order('last_message_at', { ascending: false });

      if (roomsError) { setLoadError(true); setLoading(false); return; }
      if (roomsData && roomsData.length > 0) {
        const userIds = roomsData.map((r) => r.user_id);
        // 表示名は補助情報。取得失敗時は既定表示「ユーザー」にフォールバックし、ルーム一覧本体は継続表示する。
        // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', userIds);
        const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p.display_name || 'ユーザー']));

        // Count unread
        const roomsList: ChatRoom[] = [];
        for (const r of roomsData) {
          const { count } = await supabase
            .from('chat_messages')
            .select('id', { count: 'exact', head: true })
            .eq('room_id', r.id)
            .eq('is_read', false)
            .neq('sender_id', user.id);
          roomsList.push({
            ...r,
            user_name: profileMap[r.user_id] || 'ユーザー',
            unread_count: count ?? 0,
          });
        }
        setRooms(roomsList);
      }
      setLoading(false);
  }, []);

  useEffect(() => {
    loadRooms().catch(() => { setLoadError(true); setLoading(false); });
  }, [loadRooms]);

  const loadMessages = useCallback(async (roomId: string) => {
    const supabase = supabaseRef.current;
    setMessagesError(false);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at')
      .limit(100);
    if (error) { setMessagesError(true); return; }
    setMessages((data || []) as ChatMessage[]);

    if (userId) {
      // Mark messages as read via API
      fetch(`/api/admin/chat/${roomId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).catch(() => undefined);
    }
    setRooms((prev) => prev.map((r) => r.id === roomId ? { ...r, unread_count: 0 } : r));
  }, [userId]);

  useEffect(() => {
    if (!selectedRoom) return;
    loadMessages(selectedRoom);

    const supabase = supabaseRef.current;
    const channel = supabase
      .channel(`admin-chat-${selectedRoom}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `room_id=eq.${selectedRoom}`,
      }, (payload) => {
        setMessages((prev) => [...prev, payload.new as ChatMessage]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedRoom, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || !selectedRoom || !userId) return;
    const content = input.trim();
    setInput('');
    const res = await fetch(`/api/admin/chat/${selectedRoom}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      setToast({ type: 'error', message: '送信に失敗しました' });
      setInput(content);
    }
  };

  if (loading) {
    return <div className="animate-pulse space-y-4"><div className="h-8 bg-gray-200 rounded w-1/3" /><div className="h-64 bg-gray-200 rounded-xl" /></div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">メッセージ</h1>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ height: '65vh' }}>
        <div className="flex h-full">
          {/* Room list */}
          <div className="w-1/3 border-r overflow-y-auto">
            {loadError ? (
              <div className="p-4"><LoadError onRetry={loadRooms} message="メッセージの読み込みに失敗しました" /></div>
            ) : rooms.length === 0 ? (
              <p className="text-gray-400 text-sm p-4 text-center">メッセージはありません</p>
            ) : rooms.map((room) => (
              <button
                type="button"
                key={room.id}
                onClick={() => setSelectedRoom(room.id)}
                className={`w-full text-left p-4 border-b border-gray-100 transition-colors ${
                  selectedRoom === room.id ? 'bg-sky-50' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-bold text-sm truncate">{room.user_name}</p>
                  {room.unread_count > 0 && (
                    <span className="bg-red-500 text-white text-micro font-bold px-2 py-0.5 rounded-full">{room.unread_count}</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(room.last_message_at).toLocaleDateString('ja-JP')}
                </p>
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className="flex-1 flex flex-col">
            {!selectedRoom ? (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                トークを選択してください
              </div>
            ) : messagesError ? (
              <div className="flex-1 flex items-center justify-center p-4">
                <LoadError onRetry={() => loadMessages(selectedRoom)} message="メッセージの読み込みに失敗しました" />
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.sender_id === userId ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                        msg.sender_id === userId ? 'bg-sky-500 text-white' : 'bg-gray-100 text-gray-800'
                      }`}>
                        <p className="text-sm">{msg.content}</p>
                        <p className={`text-micro mt-1 ${msg.sender_id === userId ? 'text-sky-100' : 'text-gray-400'}`}>
                          {new Date(msg.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
                <div className="border-t p-3 flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="メッセージを入力..."
                    aria-label="メッセージを入力"
                    className="flex-1 text-sm border border-gray-200 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-sky-300"
                    maxLength={1000}
                  />
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={!input.trim()}
                    aria-label="送信"
                    className="shrink-0 w-10 h-10 bg-sky-500 text-white rounded-full flex items-center justify-center hover:bg-sky-600 disabled:opacity-50 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
