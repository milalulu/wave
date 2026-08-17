CREATE TABLE IF NOT EXISTS public.playlist_shares (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  playlist_id TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  collaborator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'editor' CHECK (permission IN ('editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (playlist_id, owner_id, collaborator_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_shares_owner ON public.playlist_shares(owner_id);
CREATE INDEX IF NOT EXISTS idx_playlist_shares_collaborator ON public.playlist_shares(collaborator_id);
CREATE INDEX IF NOT EXISTS idx_playlist_shares_playlist ON public.playlist_shares(playlist_id, owner_id);

ALTER TABLE public.playlist_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can manage shares" ON public.playlist_shares
  FOR ALL USING (auth.uid() = owner_id);

CREATE POLICY "Collaborator can read own shares" ON public.playlist_shares
  FOR SELECT USING (auth.uid() = collaborator_id);

CREATE POLICY "Collaborator can update own shares" ON public.playlist_shares
  FOR UPDATE USING (auth.uid() = collaborator_id);

CREATE POLICY "Collaborator can delete own shares" ON public.playlist_shares
  FOR DELETE USING (auth.uid() = collaborator_id);

CREATE POLICY "Collaborators can read shared playlists" ON public.user_playlists
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.playlist_shares
      WHERE playlist_shares.playlist_id = user_playlists.id
        AND playlist_shares.owner_id = user_playlists.user_id
        AND playlist_shares.collaborator_id = auth.uid()
    )
  );

CREATE POLICY "Editors can update shared playlists" ON public.user_playlists
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.playlist_shares
      WHERE playlist_shares.playlist_id = user_playlists.id
        AND playlist_shares.owner_id = user_playlists.user_id
        AND playlist_shares.collaborator_id = auth.uid()
        AND playlist_shares.permission = 'editor'
    )
  );
