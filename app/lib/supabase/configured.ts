// Supabase isn't configured until a project exists and its keys are in .env.local —
// gates both auth and data-fetching so local dev keeps working on mock data until then.
export const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
