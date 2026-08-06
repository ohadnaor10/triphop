import { createBrowserClient } from "@supabase/ssr";

// `getToken`, when passed, is called per-request to attach the caller's Clerk session
// token as the Supabase JWT — see Supabase's third-party auth (Clerk) integration, which
// this project's RLS policies rely on (auth.jwt() ->> 'sub') instead of auth.uid().
//
// createBrowserClient caches a singleton per URL/key by default and ignores every
// option (including accessToken) after the first call — isSingleton: false is required
// here since each caller supplies its own live-updating token getter.
//
// AuthContext builds a client unconditionally (it needs one even when Supabase isn't
// configured yet, e.g. a fresh deploy missing env vars) — createBrowserClient throws
// synchronously on an empty URL/key, which would otherwise take down prerendering for
// every route in the app (including /_not-found) rather than failing only the requests
// that actually hit Supabase. Falling back to harmless placeholders keeps the client
// constructible; any real request against it then fails normally, same as any other
// misconfigured backend call.
export function createClient(getToken?: () => Promise<string | null>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";
  return createBrowserClient(url, key, getToken ? { accessToken: () => getToken(), isSingleton: false } : undefined);
}
