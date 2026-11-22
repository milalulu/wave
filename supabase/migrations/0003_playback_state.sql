create table if not exists public.playback_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  track jsonb,
  queue jsonb not null default '[]'::jsonb,
  track_index int not null default 0,
  position double precision not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.playback_state enable row level security;
revoke all on public.playback_state from anon;
grant select, insert, update, delete on public.playback_state to authenticated;
drop policy if exists "Playback belongs to its owner" on public.playback_state;
create policy "Playback belongs to its owner" on public.playback_state
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
