-- 0001_initial_schema.sql
-- Supabase schema for Wave account sync
-- Apply via: Supabase Dashboard → SQL Editor (run as project owner / postgres)

-- user_likes: track likes per user
CREATE TABLE IF NOT EXISTS public.user_likes (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  track JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_user_likes_user_id ON public.user_likes(user_id);
ALTER TABLE public.user_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own likes" ON public.user_likes
  FOR ALL USING (auth.uid() = user_id);

-- user_playlists: playlists per user
CREATE TABLE IF NOT EXISTS public.user_playlists (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  track_ids TEXT[] NOT NULL DEFAULT '{}',
  tracks JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cover_url TEXT,
  PRIMARY KEY (id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_playlists_user_id ON public.user_playlists(user_id);
ALTER TABLE public.user_playlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own playlists" ON public.user_playlists
  FOR ALL USING (auth.uid() = user_id);

-- user_settings: app settings per user
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  crossfade_ms INTEGER NOT NULL DEFAULT 300,
  equalizer JSONB NOT NULL DEFAULT '[]',
  theme TEXT NOT NULL DEFAULT 'system',
  accent_enabled BOOLEAN NOT NULL DEFAULT true,
  auto_continue BOOLEAN NOT NULL DEFAULT true,
  lyrics_auto_open BOOLEAN NOT NULL DEFAULT true,
  lyrics_autoscroll BOOLEAN NOT NULL DEFAULT true,
  yt_quality TEXT NOT NULL DEFAULT 'high',
  offline_mode BOOLEAN NOT NULL DEFAULT false,
  download_dir TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own settings" ON public.user_settings
  FOR ALL USING (auth.uid() = user_id);

-- user_devices: registered devices per user
CREATE TABLE IF NOT EXISTS public.user_devices (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  last_sync TIMESTAMPTZ NOT NULL DEFAULT now(),
  push_token TEXT,
  PRIMARY KEY (id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON public.user_devices(user_id);
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own devices" ON public.user_devices
  FOR ALL USING (auth.uid() = user_id);
