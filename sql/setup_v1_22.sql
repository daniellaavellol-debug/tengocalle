-- ══════════════════════════════════════════════════════════════════════════════
-- setup_v1_22.sql — CALLE v1.22
-- Ejecutar completo en Supabase SQL Editor.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. handshake_codes: agregar created_at si no existe
ALTER TABLE handshake_codes
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 2. Tabla encuentros (nueva en v1.22)
CREATE TABLE IF NOT EXISTS encuentros (
  id         UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_a_id  UUID         REFERENCES auth.users(id) NOT NULL,
  user_b_id  UUID         REFERENCES auth.users(id) NOT NULL,
  code_used  TEXT         NOT NULL,
  xp_bonus   INTEGER      DEFAULT 50,
  created_at TIMESTAMPTZ  DEFAULT now()
);

-- 3. RLS para encuentros
ALTER TABLE encuentros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can insert encuentros" ON encuentros;
CREATE POLICY "Authenticated users can insert encuentros"
  ON encuentros FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_a_id);

DROP POLICY IF EXISTS "Users can view their encuentros" ON encuentros;
CREATE POLICY "Users can view their encuentros"
  ON encuentros FOR SELECT
  TO authenticated
  USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

-- 4. Habilitar Realtime en encuentros (CRÍTICO para el pop-up en tiempo real)
ALTER PUBLICATION supabase_realtime ADD TABLE encuentros;

-- 5. Función RPC increment_xp (para grantXP en handshakeService)
CREATE OR REPLACE FUNCTION increment_xp(p_user_id UUID, p_amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET xp        = COALESCE(xp, 0) + p_amount,
      updated_at = now()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Verificación final
SELECT 'handshake_codes' AS tabla, count(*) AS filas FROM handshake_codes
UNION ALL
SELECT 'encuentros',               count(*)           FROM encuentros
UNION ALL
SELECT 'handshake_requests',       count(*)           FROM handshake_requests;
