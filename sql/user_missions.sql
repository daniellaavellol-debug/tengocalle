-- ─── user_missions ────────────────────────────────────────────────────────────
-- Tabla requerida por useMissions.ts (hooks/useMissions.ts)
-- Registra el progreso y completitud de cada misión por usuario.
--
-- IMPORTANTE: La restricción UNIQUE (user_id, mission_id) es necesaria para que
-- el upsert con onConflict: 'user_id,mission_id' funcione en Supabase (PostgREST).

CREATE TABLE IF NOT EXISTS public.user_missions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mission_id     integer     NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  status         text        NOT NULL DEFAULT 'in_progress'
                             CHECK (status IN ('not_started', 'in_progress', 'completed')),
  progress_value float4      NOT NULL DEFAULT 0,
  completed_at   timestamptz,
  xp_earned      integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_missions_user_mission_unique UNIQUE (user_id, mission_id)
);

-- ── Índices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS user_missions_user_id_idx    ON public.user_missions (user_id);
CREATE INDEX IF NOT EXISTS user_missions_mission_id_idx ON public.user_missions (mission_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_missions ENABLE ROW LEVEL SECURITY;

-- Cada usuario solo ve y modifica sus propias filas
CREATE POLICY "user_missions: own rows only"
  ON public.user_missions
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
