export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const isSupabaseConfigured = import.meta.env.VITE_WAVE_CLOUD_BETA === "1" && Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
