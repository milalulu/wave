alter table public.user_settings
  add column if not exists discovery_rate double precision not null default 0.3,
  add column if not exists history_decay_days int not null default 30,
  add column if not exists preferred_languages text[] not null default '{}',
  add column if not exists auto_generate_threshold int not null default 3;
