-- ══════════════════════════════════════════════════════════════════════════════
-- emergency_v1_22.sql — Script de emergencia CALLE v1.22
-- Ejecutar completo en Supabase SQL Editor (es idempotente, puede re-ejecutarse).
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. TABLA users ────────────────────────────────────────────────────────────
-- App.tsx y db.ts consultan y hacen upsert en public.users.
-- Crear la tabla si no existe con el esquema exacto que espera db.ts.
CREATE TABLE IF NOT EXISTS public.users (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text,
  class       text,
  multiplier  float4      DEFAULT 1.0,
  total_km    float4      DEFAULT 0,
  streak      int4        DEFAULT 0,
  encounters  int4        DEFAULT 0,
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own stats"   ON public.users;
DROP POLICY IF EXISTS "Users can upsert own stats" ON public.users;

CREATE POLICY "Users can read own stats"
  ON public.users FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can upsert own stats"
  ON public.users FOR ALL TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ── 2. missions: columna dificultad ──────────────────────────────────────────
-- missionService.ts usa .eq('dificultad', 'facil').
-- useMissions.ts usa .or('dificultad.ilike.facil,...').
-- Agregar la columna si falta y poblarla desde difficulty si existe.
ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS dificultad text;

-- Poblar dificultad desde difficulty (schema nuevo) si está vacía
UPDATE public.missions
SET dificultad = CASE
  WHEN difficulty ILIKE 'easy'   OR difficulty ILIKE 'facil'   OR difficulty ILIKE 'fácil'  THEN 'facil'
  WHEN difficulty ILIKE 'medium' OR difficulty ILIKE 'media'                                  THEN 'media'
  WHEN difficulty ILIKE 'hard'   OR difficulty ILIKE 'dificil' OR difficulty ILIKE 'difícil'
       OR difficulty ILIKE 'epic' OR difficulty ILIKE 'epica'  OR difficulty ILIKE 'épica'   THEN 'dificil'
  ELSE 'facil'
END
WHERE dificultad IS NULL AND difficulty IS NOT NULL;

-- Si difficulty tampoco existe, poner un default sensato
UPDATE public.missions
SET dificultad = 'facil'
WHERE dificultad IS NULL;

-- ── 3. profiles: columna total_km (por si algún código la lee de profiles) ────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS total_km float4 DEFAULT 0;

-- ── 4. handshake_codes: PRIMARY KEY y UNIQUE en user_id ──────────────────────
-- El upsert falla con error 400 si no hay constraint único en user_id.

-- Primero asegurar que la tabla existe con la estructura correcta
CREATE TABLE IF NOT EXISTS public.handshake_codes (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code       text        NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Si la tabla ya existe pero le falta la PK, agregarla
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.handshake_codes'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE public.handshake_codes
      ADD CONSTRAINT handshake_codes_pkey PRIMARY KEY (user_id);
  END IF;
END $$;

-- Si la tabla ya existe pero le falta created_at
ALTER TABLE public.handshake_codes
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- RLS para handshake_codes
ALTER TABLE public.handshake_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read all codes" ON public.handshake_codes;
DROP POLICY IF EXISTS "Users can insert own code"              ON public.handshake_codes;
DROP POLICY IF EXISTS "Users can update own code"              ON public.handshake_codes;

CREATE POLICY "Authenticated users can read all codes"
  ON public.handshake_codes FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Users can insert own code"
  ON public.handshake_codes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own code"
  ON public.handshake_codes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 5. tabla encuentros (nueva en v1.22) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.encuentros (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_a_id  uuid        REFERENCES auth.users(id) NOT NULL,
  user_b_id  uuid        REFERENCES auth.users(id) NOT NULL,
  code_used  text        NOT NULL,
  xp_bonus   int4        DEFAULT 50,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.encuentros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can insert encuentros" ON public.encuentros;
DROP POLICY IF EXISTS "Users can view their encuentros"           ON public.encuentros;

CREATE POLICY "Authenticated users can insert encuentros"
  ON public.encuentros FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_a_id);

CREATE POLICY "Users can view their encuentros"
  ON public.encuentros FOR SELECT TO authenticated
  USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

-- Habilitar Realtime en encuentros
ALTER PUBLICATION supabase_realtime ADD TABLE public.encuentros;

-- ── 6. Función RPC increment_xp ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_xp(p_user_id uuid, p_amount integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles
  SET    updated_at = now()
  WHERE  id = p_user_id;
  -- XP se persiste en actividades, no en profiles; este RPC es hook para futuro.
END;
$$;

-- ── 7. Verificación final ─────────────────────────────────────────────────────
SELECT 'users'           AS tabla, count(*) AS filas FROM public.users
UNION ALL SELECT 'profiles',      count(*) FROM public.profiles
UNION ALL SELECT 'missions',      count(*) FROM public.missions
UNION ALL SELECT 'handshake_codes', count(*) FROM public.handshake_codes
UNION ALL SELECT 'encuentros',    count(*) FROM public.encuentros;

-- Confirmar que dificultad está poblada
SELECT dificultad, count(*) FROM public.missions GROUP BY dificultad ORDER BY count DESC;
