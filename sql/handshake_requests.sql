-- ─── handshake_requests ───────────────────────────────────────────────────────
-- Registro de solicitudes de misión conjunta en tiempo real.
-- RLS permite que el iniciador y receptor vean solo sus propias filas.
-- Supabase Realtime (Postgres Changes) usa estas políticas para filtrar los
-- eventos que llegan al cliente — sin la política SELECT, el cliente no recibe
-- los cambios aunque tenga un filtro en el canal.

CREATE TABLE IF NOT EXISTS public.handshake_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  initiator_name text        NOT NULL DEFAULT 'Callejero',
  receiver_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'accepted', 'rejected', 'timeout')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Índices ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS handshake_requests_receiver_idx  ON public.handshake_requests (receiver_id);
CREATE INDEX IF NOT EXISTS handshake_requests_initiator_idx ON public.handshake_requests (initiator_id);

-- Limpiar requests viejos automáticamente (opcional: usar pg_cron)
-- DELETE FROM handshake_requests WHERE created_at < now() - interval '2 hours';

-- ── RLS ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.handshake_requests ENABLE ROW LEVEL SECURITY;

-- INSERT: solo con tu propio initiator_id
CREATE POLICY "hr_req: insert own"
  ON public.handshake_requests FOR INSERT
  WITH CHECK (auth.uid() = initiator_id);

-- SELECT: el iniciador ve sus requests; el receptor ve las que le llegaron
CREATE POLICY "hr_req: select participants"
  ON public.handshake_requests FOR SELECT
  USING (auth.uid() = initiator_id OR auth.uid() = receiver_id);

-- UPDATE: solo el receptor puede cambiar el status (aceptar/rechazar)
--         el iniciador puede marcar timeout (status = 'timeout')
CREATE POLICY "hr_req: update participants"
  ON public.handshake_requests FOR UPDATE
  USING (auth.uid() = receiver_id OR auth.uid() = initiator_id)
  WITH CHECK (auth.uid() = receiver_id OR auth.uid() = initiator_id);
