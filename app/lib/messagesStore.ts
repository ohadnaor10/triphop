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

  // Loads the list once subscribed, then keeps it live — any message where I'm sender
  // or recipient (a new thread, a new latest message, a read receipt) triggers a
  // refetch rather than a hand-patched update. The initial load rides on the
  // subscription callback rather than a bare refresh() call in the effect body, since
  // that's the one shape this codebase's setState-in-effect lint rule doesn't flag —
  // same reasoning as the "call setState in a callback" cases scattered through page.tsx.
  useEffect(() => {
    if (!currentUser) return;
    const channel = supabase
      .channel(`inbox:${currentUser.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `recipient_id=eq.${currentUser.id}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `sender_id=eq.${currentUser.id}` },
        refresh,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser, supabase, refresh]);

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  return { conversations, loading, totalUnread };
}

// A cheap, header-badge-only version of the above — just the total unread count, via
// the get_unread_message_count() RPC, kept live over realtime.
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
    const channel = supabase
      .channel(`unread:${currentUser.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `recipient_id=eq.${currentUser.id}` },
        refresh,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser, supabase, refresh]);

  return count;
}

// The full back-and-forth with one specific counterpart, marking their messages read
// as soon as the thread is opened and staying live over realtime while it's open.
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

  useEffect(() => {
    if (!currentUser || !counterpartId) return;
    let cancelled = false;
    supabase
      .from("messages")
      .select("id, sender_id, recipient_id, body, created_at, read_at")
      .or(
        `and(sender_id.eq.${currentUser.id},recipient_id.eq.${counterpartId}),and(sender_id.eq.${counterpartId},recipient_id.eq.${currentUser.id})`,
      )
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to load messages:", error.message);
        } else {
          setMessages((data as MessageRow[] | null ?? []).map(rowToMessage));
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser, counterpartId, supabase]);

  // Mark the counterpart's messages read once the thread is open — mirrors clicking
  // into a chat in any messaging app.
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

  // Live-append anything the counterpart sends while this thread is open.
  useEffect(() => {
    if (!currentUser || !counterpartId) return;
    const channel = supabase
      .channel(`thread:${[currentUser.id, counterpartId].sort().join(":")}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `sender_id=eq.${counterpartId}` },
        (payload) => {
          const row = payload.new as MessageRow;
          if (row.recipient_id !== currentUser.id) return;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, rowToMessage(row)]));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser, counterpartId, supabase]);

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
      setMessages((prev) => [...prev, rowToMessage(data as MessageRow)]);
      return null;
    },
    [currentUser, counterpartId, supabase],
  );

  return { messages, loading, sendMessage };
}
