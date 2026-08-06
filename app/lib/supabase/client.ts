import { createBrowserClient } from "@supabase/ssr";

// `getToken`, when passed, is called per-request to attach the caller's Clerk session
// token as the Supabase JWT — see Supabase's third-party auth (Clerk) integration, which
// this project's RLS policies rely on (auth.jwt() ->> 'sub') instead of auth.uid().
//
// createBrowserClient caches a singleton per URL/key by default and ignores every
// option (including accessToken) after the first call — isSingleton: false is required
// here since each caller supplies its own live-updating token getter.
export function createClient(getToken?: () => Promise<string | null>) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    getToken ? { accessToken: () => getToken(), isSingleton: false } : undefined,
  );
}
