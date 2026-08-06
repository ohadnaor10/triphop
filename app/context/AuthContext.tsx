"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useClerk, useUser } from "@clerk/nextjs";
import { useClerkSupabaseClient } from "../lib/supabase/useClerkSupabaseClient";

// Routes reachable before onboarding is complete — everything else redirects there.
const ONBOARDING_EXEMPT_PREFIXES = ["/onboarding", "/sign-in", "/sign-up"];

export type AuthUser = {
  id: string;
  name: string;
  firstName: string;
  avatar: string;
  avatarUrl: string | null;
  whatsapp: string;
  email: string;
};

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

type AuthContextValue = {
  currentUser: AuthUser | null;
  logout: () => void;
  /** Runs `action` if logged in; otherwise sends the user to /sign-in. */
  requireAuth: (action: () => void) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useClerkSupabaseClient();

  const currentUser: AuthUser | null = useMemo(() => {
    if (!isSignedIn || !user) return null;
    const name = user.fullName ?? user.username ?? "Traveler";
    return {
      id: user.id,
      name,
      firstName: user.firstName ?? name.split(" ")[0] ?? name,
      avatar: initialsOf(name) || "U",
      // hasImage is false for Clerk's default placeholder — only treat a genuinely
      // uploaded photo as an avatar, so everywhere else can fall back to initials.
      avatarUrl: user.hasImage ? user.imageUrl : null,
      whatsapp: user.primaryPhoneNumber?.phoneNumber ?? "",
      email: user.primaryEmailAddress?.emailAddress ?? "",
    };
  }, [isSignedIn, user]);

  // Clerk owns the account; profiles is this app's own table (destinations/posts join
  // against it), so it needs a row per Clerk user. There's no auth.users insert trigger
  // to hook anymore (Clerk users never land in Supabase's own auth schema — see
  // migration 0002), so upsert it here instead, once per signed-in user — and only
  // check onboarding completeness *after* that upsert resolves, so there's no race
  // where the row doesn't exist yet when we go looking for it.
  //
  // Onboarding (age, gender, and whatever future signup questions get added) is a
  // separate step from account creation — Clerk only knows name/email/phone. Gate
  // every other route on it being filled in, checking on each navigation since the
  // profile can go from incomplete -> complete without a full page reload.
  useEffect(() => {
    if (!currentUser) return;
    const isExempt = ONBOARDING_EXEMPT_PREFIXES.some((prefix) => pathname?.startsWith(prefix));
    let cancelled = false;

    (async () => {
      const { error: upsertError } = await supabase.from("profiles").upsert({
        id: currentUser.id,
        name: currentUser.name,
        whatsapp: currentUser.whatsapp,
        avatar_url: currentUser.avatarUrl,
        email: currentUser.email,
      });
      if (upsertError) console.error("Failed to sync profile:", upsertError.message);
      if (cancelled) return;

      const { data, error } = await supabase
        .from("profiles")
        .select("age, gender")
        .eq("id", currentUser.id)
        .single();
      if (cancelled) return;

      // Any failure to confirm a complete profile (missing row, query error, or a null
      // field) is treated as "needs onboarding" — silently doing nothing here was the
      // bug that let users reach the rest of the app (and try to post) without ever
      // getting a profiles row created.
      const needsOnboarding = Boolean(error) || !data || data.age == null || data.gender == null;
      if (needsOnboarding && !isExempt) {
        router.replace("/onboarding");
      } else if (!needsOnboarding && pathname === "/onboarding") {
        router.replace("/");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser, supabase, pathname, router]);

  const requireAuth = useCallback(
    (action: () => void) => {
      if (currentUser) {
        action();
        return;
      }
      router.push("/sign-in");
    },
    [currentUser, router],
  );

  const logout = useCallback(() => {
    signOut();
  }, [signOut]);

  return <AuthContext.Provider value={{ currentUser, logout, requireAuth }}>{children}</AuthContext.Provider>;
}
