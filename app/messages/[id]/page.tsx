"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import Avatar from "../../components/Avatar";
import { IconChevronLeft, IconSend } from "../../components/icons";
import { useAuth } from "../../context/AuthContext";
import { useThread } from "../../lib/messagesStore";
import { useClerkSupabaseClient } from "../../lib/supabase/useClerkSupabaseClient";

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

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function MessageThreadPage() {
  const { id: counterpartId } = useParams<{ id: string }>();
  const router = useRouter();
  const { currentUser } = useAuth();
  const supabase = useClerkSupabaseClient();
  const { messages, loading, sendMessage } = useThread(counterpartId ?? null);

  const [profile, setProfile] = useState<CounterpartProfile | null>(null);
  const [profileNotFound, setProfileNotFound] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!currentUser) router.replace("/sign-in");
  }, [currentUser, router]);

  useEffect(() => {
    if (!counterpartId) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("name, avatar_color, avatar_url")
      .eq("id", counterpartId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setProfileNotFound(true);
        } else {
          setProfile({ name: data.name, avatarColor: data.avatar_color, avatarUrl: data.avatar_url });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [counterpartId, supabase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (!currentUser) return null;

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (draft.trim() === "" || sending) return;
    setSending(true);
    setSendError(null);
    const error = await sendMessage(draft);
    setSending(false);
    if (error) {
      setSendError(error);
      return;
    }
    setDraft("");
  }

  return (
    <div className="flex h-dvh flex-col bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.push("/messages")}
          aria-label="Back"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition active:scale-95 active:bg-slate-200"
        >
          <IconChevronLeft className="h-4 w-4" />
        </button>
        {profile && (
          <>
            <Avatar
              url={profile.avatarUrl}
              initials={initials(profile.name)}
              colorClass={profile.avatarColor ?? undefined}
              className="h-8 w-8 shrink-0 text-xs"
            />
            <h1 className="min-w-0 truncate text-base font-bold text-slate-900">{profile.name}</h1>
          </>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col overflow-y-auto px-4 py-4">
        {loading ? (
          <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
        ) : profileNotFound ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
            This traveler couldn&apos;t be found.
          </div>
        ) : messages.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
            Say hello — this is the start of your conversation with {profile?.name ?? "them"}.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((m) => {
              const fromMe = m.senderId === currentUser.id;
              return (
                <div key={m.id} className={`flex ${fromMe ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                      fromMe ? "bg-orange-500 text-white" : "bg-white text-slate-800 ring-1 ring-slate-200"
                    }`}
                  >
                    <p className="whitespace-pre-line break-words">{m.body}</p>
                    <p className={`mt-0.5 text-[10px] ${fromMe ? "text-orange-100" : "text-slate-400"}`}>
                      {formatMessageTime(m.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </main>

      <form
        onSubmit={handleSend}
        className="sticky bottom-0 flex items-end gap-2 border-t border-slate-200 bg-white p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend(e);
            }
          }}
          placeholder="Type a message…"
          rows={1}
          className="max-h-32 flex-1 resize-none rounded-2xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
        />
        <button
          type="submit"
          disabled={draft.trim() === "" || sending}
          aria-label="Send message"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white transition active:scale-95 active:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          <IconSend className="h-4 w-4" />
        </button>
      </form>
      {sendError && <p className="bg-white px-4 pb-2 text-xs text-rose-600">{sendError}</p>}
    </div>
  );
}
