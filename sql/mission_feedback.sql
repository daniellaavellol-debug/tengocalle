-- Tabla: mission_feedback
-- Almacena feedback cualitativo (like/dislike) de usuarios sobre misiones.
-- Restricción UNIQUE(user_id, mission_id) garantiza 1 voto por usuario/misión.
-- El upsert en el hook permite cambiar el voto sin duplicar registros.

create table if not exists mission_feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  mission_id  integer not null references missions(id) on delete cascade,
  vote_type   text not null check (vote_type in ('like', 'dislike')),
  created_at  timestamptz not null default now(),

  constraint mission_feedback_unique unique (user_id, mission_id)
);

-- RLS: cada usuario solo puede leer y escribir sus propios votos
alter table mission_feedback enable row level security;

create policy "Users can read own feedback"
  on mission_feedback for select
  using (auth.uid() = user_id);

create policy "Users can insert own feedback"
  on mission_feedback for insert
  with check (auth.uid() = user_id);

create policy "Users can update own feedback"
  on mission_feedback for update
  using (auth.uid() = user_id);

create policy "Users can delete own feedback"
  on mission_feedback for delete
  using (auth.uid() = user_id);

-- Índice para queries frecuentes (filtrar por usuario)
create index if not exists idx_mission_feedback_user on mission_feedback(user_id);
