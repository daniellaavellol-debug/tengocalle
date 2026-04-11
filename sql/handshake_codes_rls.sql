-- ══════════════════════════════════════════════════════════════════════════════
-- handshake_codes_rls.sql
-- Crea la tabla (si no existe) y aplica las políticas RLS correctas.
-- Ejecutar completo en Supabase SQL Editor.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Crear tabla si no existe
CREATE TABLE IF NOT EXISTS public.handshake_codes (
  user_id  uuid  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code     text  NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- 2. Activar RLS (idempotente)
ALTER TABLE public.handshake_codes ENABLE ROW LEVEL SECURITY;

-- 3. Limpiar políticas previas para aplicar desde cero
DROP POLICY IF EXISTS "Authenticated users can read all codes"  ON public.handshake_codes;
DROP POLICY IF EXISTS "Users can upsert own code"               ON public.handshake_codes;
DROP POLICY IF EXISTS "Users can insert own code"               ON public.handshake_codes;
DROP POLICY IF EXISTS "Users can update own code"               ON public.handshake_codes;

-- 4. SELECT: cualquier usuario autenticado puede leer TODOS los códigos
--    → necesario para que lookupReceiverByCode funcione entre usuarios
CREATE POLICY "Authenticated users can read all codes"
  ON public.handshake_codes
  FOR SELECT
  TO authenticated
  USING (true);

-- 5. INSERT: cada usuario solo puede insertar su propia fila
CREATE POLICY "Users can insert own code"
  ON public.handshake_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 6. UPDATE: cada usuario solo puede actualizar su propia fila
CREATE POLICY "Users can update own code"
  ON public.handshake_codes
  FOR UPDATE
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Diagnóstico post-aplicación ───────────────────────────────────────────────
-- Ejecuta esto para confirmar que las políticas quedaron bien:

SELECT
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'handshake_codes'
ORDER BY cmd;

-- Y verifica cuántas filas tiene la tabla:
SELECT count(*) AS filas_en_handshake_codes FROM public.handshake_codes;
