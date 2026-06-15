'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import LoadError from '@/components/admin/LoadError';

interface ChatRoom {
  id: string;
  facility_id: string;
  facility_name: string;
  last_message_at: string;
}

interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export default function UserChatPage() {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
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

      const { data: roomsData, error: roomsError } = await supabase
        .from('chat_rooms')
        .select('id, facility_id, last_message_at')
        .eq('user_id', user.id)
        .order('last_message_at', { ascending: false });

      if (roomsError) { setLoadError(true); setLoading(false); return; }
      if (roomsData && roomsData.length > 0) {
        const facilityIds = roomsData.map((r) => r.facility_id);
        // 施設名は補助表示。取得失敗時は既定表示「施設」にフォールバックし一覧本体は継続。
        // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
        const { data: facilities } = await supabase
          .from('facility_profiles')
          .select('id, name')
          .in('id', facilityIds);
        const facilityMap = Object.fromEntries((facilities || []).map((f) => [f.id, f.name]));

        setRooms(roomsData.map((r) => ({
          ...r,
          facility_name: facilityMap[r.facility_id] || '施設',
        })));
      }
      setLoading(false);
  }, []);

  useEffect(() => { loadRooms().catch(() => { setLoadError(true); setLoading(false); }); }, [loadRooms]);

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

    // Mark as read
    if (userId) {
      await supabase
        .from('chat_messages')
        .update({ is_read: true })
        .eq('room_id', roomId)
        .neq('sender_id', userId);
    }
  }, [userId]);

  useEffect(() => {
    if (!selectedRoom) return;
    loadMessages(selectedRoom);

    // Realtime subscription
    const supabase = supabaseRef.current;
    const channel = supabase
      .channel(`chat-${selectedRoom}`)
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
    const supabase = supabaseRef.current;
    const { error } = await supabase.from('chat_messages').insert({
      room_id: selectedRoom,
      sender_id: userId,
      content: input.trim(),
    });
    if (error) {
      setToast({ type: 'error', message: '送信に失敗しました' });
      return;
    }
    setInput('');
    await supabase.from('chat_rooms').update({ last_message_at: new Date().toISOString() }).eq('id', selectedRoom);
  };

  if (loading) {
    return <div className="animate-pulse space-y-4"><div className="h-8 bg-gray-200 rounded w-1/3" /><div className="h-64 bg-gray-200 rounded-xl" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h1 className="text-xl font-bold">メッセージ</h1>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ height: '70vh' }}>
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
                <p className="font-bold text-sm truncate">{room.facility_name}</p>
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
                    className="shrink-0 w-10 h-10 bg-sky-600 text-white rounded-full flex items-center justify-center hover:bg-sky-700 disabled:opacity-50 transition-colors"
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
