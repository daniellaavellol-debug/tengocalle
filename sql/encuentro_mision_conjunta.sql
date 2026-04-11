-- ══════════════════════════════════════════════════════════════════════════════
-- encuentro_mision_conjunta.sql — CALLE v1.23
-- Ejecutar en Supabase SQL Editor.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Agregar columna status a encuentros
ALTER TABLE public.encuentros
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'
  CHECK (status IN ('pending', 'accepted', 'rejected', 'expired'));

-- 2. Índice para queries por status (polling / filtros futuros)
CREATE INDEX IF NOT EXISTS idx_encuentros_status
  ON public.encuentros(status);

-- 3. Política RLS: B puede actualizar el status de SUS encuentros
DROP POLICY IF EXISTS "user_b_can_update_status" ON public.encuentros;
CREATE POLICY "user_b_can_update_status"
  ON public.encuentros FOR UPDATE
  TO authenticated
  USING  (auth.uid() = user_b_id)
  WITH CHECK (auth.uid() = user_b_id);

-- 4. Política RLS: A también necesita poder leer el UPDATE de su encuentro
--    (para subscribeToEncuentroUpdates — Realtime filtra por id)
DROP POLICY IF EXISTS "user_a_can_read_own_encuentro" ON public.encuentros;
CREATE POLICY "user_a_can_read_own_encuentro"
  ON public.encuentros FOR SELECT
  TO authenticated
  USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

-- 5. Verificación
SELECT id, user_a_id, user_b_id, status, created_at
FROM   public.encuentros
ORDER  BY created_at DESC
LIMIT  5;
