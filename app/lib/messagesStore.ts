"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useClerkSupabaseClient } from "./supabase/useClerkSupabaseClient";

export type Message = {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

export type Conversation = {
  counterpartId: string;
  lastMessageBody: string;
  lastMessageSenderId: string;
  lastMessageAt: string;
  unreadCount: number;
};

type MessageRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

// Polling intervals, not Supabase Realtime websockets: Realtime's authorization for
// RLS-protected tables (like messages) doesn't reliably carry Clerk's third-party JWT
// the way it does Supabase's own auth — messages were only ever showing up after a
// full reload, i.e. the subscription was silently never actually live. Polling only
// depends on the same REST path already proven to work for every other query in this
// app, at the cost of a few seconds' latency instead of instant delivery.
const THREAD_POLL_MS = 3000;
const INBOX_POLL_MS = 5000;
const UNREAD_BADGE_POLL_MS = 10000;

// Lists every conversation the signed-in user is in, newest first, with an unread
// count per counterpart — backed by the my_conversations/my_unread_counts views
// (see migration 0011), which enforce the same "participants only" RLS as the
// underlying messages table.
export function useConversations() {
  const { currentUser } = useAuth();
  const supabase = useClerkSupabaseClient();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  // Reset synchronously on user change, rather than in the fetch effect below — same
  // pattern used elsewhere in this app (e.g. page.tsx's myWhatsappForUserId).
  const [loadedForUserId, setLoadedForUserId] = useState<string | null>(null);
  if ((currentUser?.id ?? null) !== loadedForUserId) {
    setLoadedForUserId(currentUser?.id ?? null);
    setConversations([]);
    setLoading(currentUser !== null);
  }

  const refresh = useCallback(async () => {
    if (!currentUser) return;
    const [{ data: convData, error: convError }, { data: unreadData }] = await Promise.all([
      supabase.from("my_conversations").select("*").order("last_message_at", { ascending: false }),
      supabase.from("my_unread_counts").select("*"),
    ]);
    if (convError) {
      console.error("Failed to load conversations:", convError.message);
      setLoading(false);
      return;
    }
    const unreadByCounterpart = new Map(
      (unreadData ?? []).map((r: { counterpart_id: string; unread_count: number }) => [r.counterpart_id, r.unread_count]),
    );
    setConversations(
      (convData ?? []).map(
        (r: {
          counterpart_id: string;
          last_message_body: string;
          last_message_sender_id: string;
          last_message_at: string;
        }) => ({
          counterpartId: r.counterpart_id,
          lastMessageBody: r.last_message_body,
          lastMessageSenderId: r.last_message_sender_id,
          lastMessageAt: r.last_message_at,
          unreadCount: unreadByCounterpart.get(r.counterpart_id) ?? 0,
        }),
      ),
    );
    setLoading(false);
  }, [currentUser, supabase]);

  useEffect(() => {
    if (!currentUser) return;
    // Deferred via setTimeout/setInterval callbacks rather than a bare refresh() call
    // in the effect body, per this codebase's setState-in-effect lint rule.
    const kick = setTimeout(refresh, 0);
    const timer = setInterval(refresh, INBOX_POLL_MS);
    return () => {
      clearTimeout(kick);
      clearInterval(timer);
    };
  }, [currentUser, refresh]);

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  return { conversations, loading, totalUnread };
}

// A cheap, header-badge-only version of the above — just the total unread count, via
// the get_unread_message_count() RPC.
export function useUnreadMessageCount() {
  const { currentUser } = useAuth();
  const supabase = useClerkSupabaseClient();
  const [count, setCount] = useState(0);

  const [countedForUserId, setCountedForUserId] = useState<string | null>(null);
  if ((currentUser?.id ?? null) !== countedForUserId) {
    setCountedForUserId(currentUser?.id ?? null);
    setCount(0);
  }

  const refresh = useCallback(() => {
    if (!currentUser) return;
    supabase.rpc("get_unread_message_count").then(({ data, error }) => {
      if (!error) setCount(Number(data ?? 0));
    });
  }, [currentUser, supabase]);

  useEffect(() => {
    if (!currentUser) return;
    const kick = setTimeout(refresh, 0);
    const timer = setInterval(refresh, UNREAD_BADGE_POLL_MS);
    return () => {
      clearTimeout(kick);
      clearInterval(timer);
    };
  }, [currentUser, refresh]);

  return count;
}

// The full back-and-forth with one specific counterpart, marking their messages read
// as soon as the thread is opened and polling for new ones while it stays open.
export function useThread(counterpartId: string | null) {
  const { currentUser } = useAuth();
  const supabase = useClerkSupabaseClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  // Reset synchronously when the open thread changes, rather than in the fetch effect.
  const [loadedForCounterpartId, setLoadedForCounterpartId] = useState<string | null>(null);
  if (counterpartId !== loadedForCounterpartId) {
    setLoadedForCounterpartId(counterpartId);
    setMessages([]);
    setLoading(counterpartId !== null);
  }

  const load = useCallback(async () => {
    if (!currentUser || !counterpartId) return;
    const { data, error } = await supabase
      .from("messages")
      .select("id, sender_id, recipient_id, body, created_at, read_at")
      .or(
        `and(sender_id.eq.${currentUser.id},recipient_id.eq.${counterpartId}),and(sender_id.eq.${counterpartId},recipient_id.eq.${currentUser.id})`,
      )
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Failed to load messages:", error.message);
      setLoading(false);
      return;
    }
    setMessages((data as MessageRow[] | null ?? []).map(rowToMessage));
    setLoading(false);
  }, [currentUser, counterpartId, supabase]);

  useEffect(() => {
    if (!currentUser || !counterpartId) return;
    const kick = setTimeout(load, 0);
    const timer = setInterval(load, THREAD_POLL_MS);
    return () => {
      clearTimeout(kick);
      clearInterval(timer);
    };
  }, [currentUser, counterpartId, load]);

  // Mark the counterpart's messages read once the thread is open (and again each time
  // polling turns up new ones) — mirrors clicking into a chat in any messaging app.
  useEffect(() => {
    if (!currentUser || !counterpartId) return;
    supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", currentUser.id)
      .eq("sender_id", counterpartId)
      .is("read_at", null)
      .then(({ error }) => {
        if (error) console.error("Failed to mark messages read:", error.message);
      });
  }, [currentUser, counterpartId, supabase, messages.length]);

  const sendMessage = useCallback(
    async (body: string) => {
      if (!currentUser || !counterpartId) return "Not signed in";
      const trimmed = body.trim();
      if (trimmed === "") return "Message can't be empty";
      const { data, error } = await supabase
        .from("messages")
        .insert({ sender_id: currentUser.id, recipient_id: counterpartId, body: trimmed })
        .select("id, sender_id, recipient_id, body, created_at, read_at")
        .single();
      if (error || !data) return error?.message ?? "Failed to send message";
      setMessages((prev) => (prev.some((m) => m.id === (data as MessageRow).id) ? prev : [...prev, rowToMessage(data as MessageRow)]));
      return null;
    },
    [currentUser, counterpartId, supabase],
  );

  return { messages, loading, sendMessage };
}
