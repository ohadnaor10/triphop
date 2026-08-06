"use client";

import { useCallback, useMemo } from "react";
import { useSession } from "@clerk/nextjs";
import { createClient } from "./client";

// Recreated only when the Clerk session identity actually changes (sign-in/sign-out),
// so effects keyed on this client re-run exactly when the signed-in user does.
export function useClerkSupabaseClient() {
  const { session } = useSession();
  const getToken = useCallback(() => session?.getToken() ?? Promise.resolve(null), [session]);
  return useMemo(() => createClient(getToken), [getToken]);
}
