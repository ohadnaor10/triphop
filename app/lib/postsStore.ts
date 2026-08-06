"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { INITIAL_POSTS } from "../data/mockPosts";
import type { Destination, Gender, Post, TripDate, TripVibe } from "../page";
import { useClerkSupabaseClient } from "./supabase/useClerkSupabaseClient";
import { SUPABASE_CONFIGURED } from "./supabase/configured";

const AVATAR_COLORS = [
  "bg-gradient-to-br from-orange-400 to-pink-500",
  "bg-gradient-to-br from-sky-400 to-indigo-500",
  "bg-gradient-to-br from-emerald-400 to-teal-500",
  "bg-gradient-to-br from-fuchsia-400 to-purple-500",
];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export type PostInput = {
  destinations: Destination[];
  date: TripDate;
  vibes: TripVibe[];
  bio: string;
};

export type PostsStore = {
  posts: Post[];
  savedPostIds: Set<string>;
  loading: boolean;
  /** Returns an error message on failure, or null on success. */
  addPost: (input: PostInput) => Promise<string | null>;
  /** Returns an error message on failure, or null on success. */
  editPost: (id: string, input: PostInput) => Promise<string | null>;
  removePost: (id: string) => Promise<void>;
  toggleSaved: (postId: string) => Promise<void>;
  /** Contact number is never included in the public feed — fetched on demand, only for signed-in callers. */
  revealContact: (postId: string) => Promise<string | null>;
};

// SUPABASE_CONFIGURED is fixed for the lifetime of the build (an env var, not state),
// so resolving which hook to use at module scope keeps each one's call order stable —
// unlike branching inside a function body, which react-hooks/rules-of-hooks flags.
export const usePostsStore: () => PostsStore = SUPABASE_CONFIGURED ? useSupabasePostsStore : useMockPostsStore;

// ---------- Mock store (pre-Supabase-setup fallback) ----------

function useMockPostsStore(): PostsStore {
  const { currentUser } = useAuth();
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS);
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(new Set());

  const addPost = useCallback(
    async (input: PostInput) => {
      if (!currentUser) return "Not signed in";
      const newPost: Post = {
        id: crypto.randomUUID(),
        userId: currentUser.id,
        user: {
          name: currentUser.name,
          age: 0,
          gender: "Male" as Gender,
          avatarColor: colorFor(currentUser.id),
          avatarUrl: currentUser.avatarUrl,
        },
        destinations: input.destinations,
        date: input.date,
        vibes: input.vibes,
        bio: input.bio,
        whatsapp: currentUser.whatsapp ? `https://wa.me/${currentUser.whatsapp.replace(/\D/g, "")}` : "",
        createdAt: new Date().toISOString(),
      };
      setPosts((prev) => [newPost, ...prev]);
      return null;
    },
    [currentUser],
  );

  const editPost = useCallback(async (id: string, input: PostInput) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, destinations: input.destinations, date: input.date, vibes: input.vibes, bio: input.bio } : p,
      ),
    );
    return null;
  }, []);

  const removePost = useCallback(async (id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
    setSavedPostIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const toggleSaved = useCallback(async (postId: string) => {
    setSavedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }, []);

  const revealContact = useCallback(
    async (postId: string) => {
      if (!currentUser) return null;
      return posts.find((p) => p.id === postId)?.whatsapp ?? null;
    },
    [currentUser, posts],
  );

  return { posts, savedPostIds, loading: false, addPost, editPost, removePost, toggleSaved, revealContact };
}

// ---------- Real store (Supabase-backed) ----------

type PostRow = {
  id: string;
  user_id: string;
  destinations: Destination[];
  date: TripDate;
  vibes: TripVibe[];
  bio: string;
  created_at: string;
  profiles: {
    name: string;
    age: number | null;
    gender: Gender | null;
    avatar_color: string | null;
    avatar_url: string | null;
    about: string | null;
  } | null;
};

// whatsapp is deliberately excluded — the `profiles` table revokes public SELECT on
// that column (see migration 0001), so it can only be fetched via get_post_contact().
// The `!user_id` hint disambiguates the embed for PostgREST when it can see more than
// one possible join path between posts and profiles.
const POST_SELECT =
  "id, user_id, destinations, date, vibes, bio, created_at, profiles!user_id(name, age, gender, avatar_color, avatar_url, about)";

function rowToPost(row: PostRow): Post {
  const profile = row.profiles;
  return {
    id: row.id,
    userId: row.user_id,
    user: {
      name: profile?.name ?? "Traveler",
      age: profile?.age ?? 0,
      gender: profile?.gender ?? "Male",
      avatarColor: profile?.avatar_color ?? colorFor(row.user_id),
      avatarUrl: profile?.avatar_url ?? null,
      about: profile?.about ?? undefined,
    },
    destinations: row.destinations,
    date: row.date,
    vibes: row.vibes,
    bio: row.bio,
    whatsapp: "",
    createdAt: row.created_at,
  };
}

function useSupabasePostsStore(): PostsStore {
  const { currentUser } = useAuth();
  const supabase = useClerkSupabaseClient();
  const [posts, setPosts] = useState<Post[]>([]);
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Reset saves synchronously on logout (adjusting state during render, not in an
  // effect, per https://react.dev/learn/you-might-not-need-an-effect).
  const [savedForUserId, setSavedForUserId] = useState<string | null>(null);
  if ((currentUser?.id ?? null) !== savedForUserId) {
    setSavedForUserId(currentUser?.id ?? null);
    if (!currentUser) setSavedPostIds(new Set());
  }

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("posts")
      .select(POST_SELECT)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to load posts:", error.message);
        } else if (data) {
          setPosts((data as unknown as PostRow[]).map(rowToPost));
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    supabase
      .from("saved_posts")
      .select("post_id")
      .eq("user_id", currentUser.id)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setSavedPostIds(new Set(data.map((row: { post_id: string }) => row.post_id)));
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser, supabase]);

  const addPost = useCallback(
    async (input: PostInput) => {
      if (!currentUser) return "Not signed in";
      const { data, error } = await supabase
        .from("posts")
        .insert({ user_id: currentUser.id, destinations: input.destinations, date: input.date, vibes: input.vibes, bio: input.bio })
        .select(POST_SELECT)
        .single();
      if (error || !data) {
        console.error("Failed to create post:", error);
        return error?.message ?? "Failed to create post";
      }
      setPosts((prev) => [rowToPost(data as unknown as PostRow), ...prev]);
      return null;
    },
    [currentUser, supabase],
  );

  const editPost = useCallback(
    async (id: string, input: PostInput) => {
      const { data, error } = await supabase
        .from("posts")
        .update({ destinations: input.destinations, date: input.date, vibes: input.vibes, bio: input.bio })
        .eq("id", id)
        .select(POST_SELECT)
        .single();
      if (error || !data) {
        console.error("Failed to update post:", error);
        return error?.message ?? "Failed to update post";
      }
      const updated = rowToPost(data as unknown as PostRow);
      setPosts((prev) => prev.map((p) => (p.id === id ? updated : p)));
      return null;
    },
    [supabase],
  );

  const removePost = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("posts").delete().eq("id", id);
      if (error) {
        console.error("Failed to delete post:", error.message);
        return;
      }
      setPosts((prev) => prev.filter((p) => p.id !== id));
      setSavedPostIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [supabase],
  );

  const toggleSaved = useCallback(
    async (postId: string) => {
      if (!currentUser) return;
      if (savedPostIds.has(postId)) {
        const { error } = await supabase
          .from("saved_posts")
          .delete()
          .eq("user_id", currentUser.id)
          .eq("post_id", postId);
        if (error) {
          console.error("Failed to unsave post:", error.message);
          return;
        }
        setSavedPostIds((prev) => {
          const next = new Set(prev);
          next.delete(postId);
          return next;
        });
      } else {
        const { error } = await supabase.from("saved_posts").insert({ user_id: currentUser.id, post_id: postId });
        if (error) {
          console.error("Failed to save post:", error.message);
          return;
        }
        setSavedPostIds((prev) => new Set(prev).add(postId));
      }
    },
    [currentUser, savedPostIds, supabase],
  );

  const revealContact = useCallback(
    async (postId: string) => {
      if (!currentUser) return null;
      const { data, error } = await supabase.rpc("get_post_contact", { p_post_id: postId });
      if (error || !data) {
        if (error) console.error("Failed to reveal contact:", error.message);
        return null;
      }
      return `https://wa.me/${String(data).replace(/\D/g, "")}`;
    },
    [currentUser, supabase],
  );

  return { posts, savedPostIds, loading, addPost, editPost, removePost, toggleSaved, revealContact };
}
