"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "../components/Avatar";
import { IconChevronLeft } from "../components/icons";
import { useAuth } from "../context/AuthContext";
import { useConversations } from "../lib/messagesStore";
import { useClerkSupabaseClient } from "../lib/supabase/useClerkSupabaseClient";

type CounterpartProfile = {
  name: string;
  avatarColor: string | null;
  avatarUrl: string | null;
};

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("");
}

// Coarse "time ago" — a conversation list doesn't need the minute-level precision a
// single post's "Posted X ago" does, so this collapses straight to days once it's not
// today, rather than spelling out "23 hours ago".
function formatConversationTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const days = Math.round((now.getTime() - date.getTime()) / 86_400_000);
  if (days < 7) return date.toLocaleDateString("en-US", { weekday: "short" });
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function MessagesInboxPage() {
  const router = useRouter();
  const { currentUser, isAuthLoaded } = useAuth();
  const supabase = useClerkSupabaseClient();
  const { conversations, loading } = useConversations();
  const [profiles, setProfiles] = useState<Record<string, CounterpartProfile>>({});

  useEffect(() => {
    // Wait for Clerk to finish checking the session — otherwise an actually-signed-in
    // user gets bounced to /sign-in during the brief window before it's loaded.
    if (isAuthLoaded && !currentUser) router.replace("/sign-in");
  }, [isAuthLoaded, currentUser, router]);

  useEffect(() => {
    const ids = conversations.map((c) => c.counterpartId);
    if (ids.length === 0) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("id, name, avatar_color, avatar_url")
      .in("id", ids)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setProfiles(
          Object.fromEntries(
            data.map((row: { id: string; name: string; avatar_color: string | null; avatar_url: string | null }) => [
              row.id,
              { name: row.name, avatarColor: row.avatar_color, avatarUrl: row.avatar_url },
            ]),
          ),
        );
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch whenever the set of counterparts changes, not on every conversations
    // update (e.g. a new last-message preview shouldn't trigger a fresh profile fetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.map((c) => c.counterpartId).join(","), supabase]);

  if (!currentUser) return null;

  return (
    <div className="min-h-dvh bg-slate-50 pb-16 text-slate-900">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.push("/")}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition active:scale-95 active:bg-slate-200"
        >
          <IconChevronLeft className="h-4 w-4" />
        </button>
        <h1 className="text-base font-bold text-slate-900">Messages</h1>
      </header>

      <main className="mx-auto flex max-w-lg flex-col px-4 py-3">
        {loading ? (
          <p className="px-1 py-6 text-center text-sm text-slate-400">Loading…</p>
        ) : conversations.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
            No conversations yet. Message someone from a post or their profile to start one.
          </div>
        ) : (
          <div className="mt-1 flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            {conversations.map((c, i) => {
              const profile = profiles[c.counterpartId];
              const isUnread = c.unreadCount > 0;
              const fromMe = c.lastMessageSenderId === currentUser.id;
              return (
                <button
                  key={c.counterpartId}
                  type="button"
                  onClick={() => router.push(`/messages/${c.counterpartId}`)}
                  className={`flex items-center gap-3 px-3 py-3 text-left transition hover:bg-slate-50 ${
                    i > 0 ? "border-t border-slate-100" : ""
                  }`}
                >
                  <Avatar
                    url={profile?.avatarUrl}
                    initials={initials(profile?.name ?? "?")}
                    colorClass={profile?.avatarColor ?? undefined}
                    className="h-11 w-11 shrink-0 text-sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`truncate text-sm ${isUnread ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>
                        {profile?.name ?? "Traveler"}
                      </p>
                      <span className={`shrink-0 text-xs ${isUnread ? "font-semibold text-orange-600" : "text-slate-400"}`}>
                        {formatConversationTime(c.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className={`truncate text-xs ${isUnread ? "font-semibold text-slate-700" : "text-slate-500"}`}>
                        {fromMe ? "You: " : ""}
                        {c.lastMessageBody}
                      </p>
                      {isUnread && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] font-bold text-white">
                          {c.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
