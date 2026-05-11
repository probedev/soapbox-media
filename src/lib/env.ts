/**
 * Typed environment variable accessor.
 *
 * Use getters so missing-required-key errors only fire when the key is
 * actually read — not at module import time. This means a missing
 * ANTHROPIC_API_KEY won't break a Supabase-only script.
 */

function required(key: string): string {
  const v = process.env[key];
  if (!v) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        `Set it in .env.local (local dev) or Vercel project settings (production).`,
    );
  }
  return v;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get anthropicApiKey() {
    return required("ANTHROPIC_API_KEY");
  },
  get podscanApiKey() {
    return required("PODSCAN_API_KEY");
  },
  get youtubeApiKey() {
    return required("YOUTUBE_API_KEY");
  },
};
