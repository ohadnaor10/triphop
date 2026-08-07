"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Avatar from "../../components/Avatar";
import { IconCalendar, IconChevronLeft, IconMapPin, IconMessageCircle } from "../../components/icons";
import { useAuth } from "../../context/AuthContext";
import { usePostsStore } from "../../lib/postsStore";
import { useClerkSupabaseClient } from "../../lib/supabase/useClerkSupabaseClient";
import type { Gender, Post } from "../../page";

type PublicProfile = {
  name: string;
  age: number | null;
  gender: Gender | null;
  avatarColor: string | null;
  avatarUrl: string | null;
  about: string | null;
};

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("");
}

function formatGender(gender: Gender | null): string | null {
  if (!gender) return null;
  return gender === "Male" ? "M" : "F";
}

// Same compact treatment as the "My posts" list on the own-profile page.
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

export default function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { currentUser } = useAuth();
  const supabase = useClerkSupabaseClient();
  const { posts } = usePostsStore();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const isOwnProfile = currentUser?.id === id;

  // "My Profile" is its own editable page — redirect there instead of duplicating it.
  useEffect(() => {
    if (isOwnProfile) router.replace("/profile");
  }, [isOwnProfile, router]);

  useEffect(() => {
    if (isOwnProfile) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("name, age, gender, avatar_color, avatar_url, about")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setNotFound(true);
        } else {
          setProfile({
            name: data.name,
            age: data.age,
            gender: data.gender,
            avatarColor: data.avatar_color,
            avatarUrl: data.avatar_url,
            about: data.about,
          });
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, supabase, isOwnProfile]);

  if (isOwnProfile) return null;

  const userPosts = posts.filter((p) => p.userId === id);

  return (
    <div className="min-h-dvh bg-slate-50 pb-16 text-slate-900">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition active:scale-95 active:bg-slate-200"
        >
          <IconChevronLeft className="h-4 w-4" />
        </button>
        <h1 className="text-base font-bold text-slate-900">Profile</h1>
      </header>

      <main className="mx-auto flex max-w-lg flex-col gap-5 px-4 py-5">
        {loading ? (
          <p className="px-1 text-sm text-slate-400">Loading…</p>
        ) : notFound || !profile ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
            This traveler couldn&apos;t be found.
          </div>
        ) : (
          <>
            <section className="flex flex-col items-center gap-3 rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-200">
              <Avatar
                url={profile.avatarUrl}
                initials={initials(profile.name)}
                colorClass={profile.avatarColor ?? undefined}
                className="h-20 w-20 text-2xl"
              />
              <div>
                <p className="text-lg font-bold text-slate-900">{profile.name}</p>
                {(profile.age !== null || profile.gender) && (
                  <p className="text-sm text-slate-500">
                    {[profile.age, formatGender(profile.gender)].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              {profile.about && (
                <p className="text-sm italic leading-relaxed text-slate-600">&ldquo;{profile.about}&rdquo;</p>
              )}

              <button
                type="button"
                disabled
                title="Chat is coming soon"
                className="mt-1 flex cursor-not-allowed items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-400"
              >
                <IconMessageCircle className="h-4 w-4" />
                Message (coming soon)
              </button>
            </section>

            <section>
              <h2 className="px-1 text-sm font-bold text-slate-900">{profile.name.split(" ")[0]}&apos;s posts</h2>
              <div className="mt-2 flex flex-col gap-3">
                {userPosts.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
                    No trips posted yet.
                  </div>
                )}
                {userPosts.map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => router.push(`/?post=${post.id}`)}
                    className="rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:shadow-md active:scale-[0.99]"
                  >
                    <div className="flex min-w-0 items-start gap-1.5">
                      <IconMapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                      <h3 className="min-w-0 truncate text-sm font-bold text-slate-900">{formatDestinationLabel(post)}</h3>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 pl-[22px] text-xs text-slate-500">
                      <IconCalendar className="h-3.5 w-3.5 shrink-0" />
                      {formatDateLabel(post)}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
