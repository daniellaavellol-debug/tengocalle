-- ─── handshake_redemptions ────────────────────────────────────────────────────
-- Libro de registro de encuentros callejeros.
-- El constraint UNIQUE (redeemer_id, code_used) es el candado de base de datos:
-- impide que un mismo usuario use el mismo código más de una vez, incluso ante
-- race conditions o reintentos de red.

CREATE TABLE IF NOT EXISTS public.handshake_redemptions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  redeemer_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_used    text        NOT NULL,
  redeemed_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT handshake_redemptions_unique UNIQUE (redeemer_id, code_used)
);

-- ── Índice para lookups por redeemer ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS handshake_redemptions_redeemer_idx
  ON public.handshake_redemptions (redeemer_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.handshake_redemptions ENABLE ROW LEVEL SECURITY;

-- SELECT: cada usuario solo ve sus propios canjes
CREATE POLICY "hr: select own"
  ON public.handshake_redemptions FOR SELECT
  USING (auth.uid() = redeemer_id);

-- INSERT: solo puede insertar con su propio redeemer_id
CREATE POLICY "hr: insert own"
  ON public.handshake_redemptions FOR INSERT
  WITH CHECK (auth.uid() = redeemer_id);
