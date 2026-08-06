"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import Avatar from "../components/Avatar";
import {
  IconAlertTriangle,
  IconCalendar,
  IconChevronLeft,
  IconEdit,
  IconGlobe,
  IconHeart,
  IconMapPin,
  IconTrash,
} from "../components/icons";
import { useAuth } from "../context/AuthContext";
import { calculateAge } from "../lib/calendar";
import { usePostsStore } from "../lib/postsStore";
import { useClerkSupabaseClient } from "../lib/supabase/useClerkSupabaseClient";
import type { Gender, Post } from "../page";

const MIN_AGE = 13;
const MAX_AGE = 120;

function isValidBirthDate(birthDate: string): boolean {
  if (!birthDate) return false;
  const age = calculateAge(birthDate);
  return age >= MIN_AGE && age <= MAX_AGE;
}

// Compact, single-line summary matching the feed card's treatment of long lists —
// country/region names only (no cities), capped so it stays scannable in this list.
const MAX_DESTINATIONS_SHOWN = 2;

function formatDestinationLabel(post: Post): string {
  const names = post.destinations.map((d) => (d.mode === "focused" ? d.country : d.regions.join(" · ")));
  const shown = names.slice(0, MAX_DESTINATIONS_SHOWN);
  const extra = names.length - shown.length;
  const label = shown.join("  +  ");
  return extra > 0 ? `${label}  +${extra} more` : label;
}

function formatDateLabel(post: Post): string {
  if (post.date.mode === "focused") return `${post.date.startDate} – ${post.date.endDate}`;
  if (post.date.mode === "flexible") return `${post.date.earliest} – ${post.date.latest}`;
  return post.date.months.join(", ");
}

// Non-functional yet, but the shape the profile should grow into — surfaced now so the
// page reads as complete rather than half-built, with real wiring to follow later.
const COMING_SOON_CARDS = [
  {
    icon: IconAlertTriangle,
    title: "Notification preferences",
    description: "Choose when TripHop emails or messages you about new matches.",
  },
  {
    icon: IconGlobe,
    title: "Language & region",
    description: "Set your preferred language and currency.",
  },
  {
    icon: IconHeart,
    title: "Privacy & visibility",
    description: "Control who can see your posts and contact you.",
  },
  {
    icon: IconTrash,
    title: "Delete account",
    description: "Permanently remove your profile and posts.",
  },
];

export default function ProfilePage() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { openUserProfile } = useClerk();
  const supabase = useClerkSupabaseClient();
  const { posts, removePost } = usePostsStore();

  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [about, setAbout] = useState("");
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!currentUser) {
      router.replace("/sign-in");
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("gender, birth_date, about")
      .eq("id", currentUser.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) {
          setGender(data.gender ?? "");
          setBirthDate(data.birth_date ?? "");
          setAbout(data.about ?? "");
        }
        setIsLoadingProfile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser, supabase, router]);

  if (!currentUser) return null;

  const myPosts = posts.filter((p) => p.userId === currentUser.id);

  async function handleSaveDetails() {
    if (!currentUser) return;
    if (!gender || !isValidBirthDate(birthDate)) return;
    setIsSaving(true);
    setSaveError(null);
    setSaved(false);
    const { error } = await supabase.from("profiles").upsert({
      id: currentUser.id,
      name: currentUser.name,
      birth_date: birthDate,
      age: calculateAge(birthDate),
      gender,
      about: about.trim() || null,
    });
    setIsSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setSaved(true);
  }

  function handleDeletePost(postId: string) {
    if (window.confirm("Delete this trip post?")) removePost(postId);
  }

  const detailsValid = gender !== "" && isValidBirthDate(birthDate);

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
        <h1 className="text-base font-bold text-slate-900">My Profile</h1>
      </header>

      <main className="mx-auto flex max-w-lg flex-col gap-5 px-4 py-5">
        {/* Account card */}
        <section className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <Avatar url={currentUser.avatarUrl} initials={currentUser.avatar} className="h-14 w-14 text-lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-slate-900">{currentUser.name}</p>
            {currentUser.whatsapp && <p className="truncate text-sm text-slate-500">{currentUser.whatsapp}</p>}
          </div>
          <button
            type="button"
            onClick={() => openUserProfile()}
            className="shrink-0 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition active:scale-95"
          >
            Manage account
          </button>
        </section>

        {/* About you */}
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-bold text-slate-900">About you</h2>
          <p className="mt-0.5 text-xs text-slate-500">Shown to other travelers on your posts.</p>

          {isLoadingProfile ? (
            <p className="mt-3 text-sm text-slate-400">Loading…</p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Birth date{birthDate && isValidBirthDate(birthDate) ? ` · Age ${calculateAge(birthDate)}` : ""}
                </label>
                <input
                  type="date"
                  value={birthDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => {
                    setBirthDate(e.target.value);
                    setSaved(false);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Gender</label>
                <div className="flex gap-2">
                  {(["Male", "Female"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setGender(option);
                        setSaved(false);
                      }}
                      className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-inset transition ${
                        gender === option
                          ? "bg-orange-50 text-orange-700 ring-orange-500"
                          : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">About you (optional)</label>
                <textarea
                  value={about}
                  onChange={(e) => {
                    setAbout(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="A short line about yourself for other travelers…"
                  rows={3}
                  className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </div>

              {saveError && <p className="text-xs text-rose-600">{saveError}</p>}
              {saved && <p className="text-xs font-medium text-emerald-600">Saved.</p>}

              <button
                type="button"
                onClick={handleSaveDetails}
                disabled={!detailsValid || isSaving}
                className="rounded-xl bg-orange-500 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] active:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {isSaving ? "Saving…" : "Save changes"}
              </button>
            </div>
          )}
        </section>

        {/* My posts */}
        <section>
          <h2 className="px-1 text-sm font-bold text-slate-900">My posts</h2>
          <div className="mt-2 flex flex-col gap-3">
            {myPosts.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
                You haven&apos;t posted any trips yet.
              </div>
            )}
            {myPosts.map((post) => (
              <div key={post.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-1.5">
                    <IconMapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                    <h3 className="min-w-0 truncate text-sm font-bold text-slate-900">{formatDestinationLabel(post)}</h3>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      aria-label="Edit trip"
                      onClick={() => router.push(`/?post=${post.id}`)}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition hover:text-slate-700 active:scale-90"
                    >
                      <IconEdit className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete trip"
                      onClick={() => handleDeletePost(post.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition hover:text-rose-600 active:scale-90"
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-1.5 pl-[22px] text-xs text-slate-500">
                  <IconCalendar className="h-3.5 w-3.5 shrink-0" />
                  {formatDateLabel(post)}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Coming soon */}
        <section>
          <h2 className="px-1 text-sm font-bold text-slate-900">More</h2>
          <div className="mt-2 flex flex-col gap-2">
            {COMING_SOON_CARDS.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-slate-200 opacity-70"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{title}</p>
                  <p className="truncate text-xs text-slate-500">{description}</p>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Coming soon
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
