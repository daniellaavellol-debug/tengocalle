-- ─── Migración: añadir encounter_code a profiles ─────────────────────────────
-- encounter_code: código estático de 4 dígitos derivado del UUID del usuario.
-- Se almacena en BD para poder buscar quién es el dueño de un código dado.
-- Un índice UNIQUE garantiza que dos usuarios no comparten el mismo código
-- (en la práctica puede haber colisiones al derivar — el UNIQUE lo detecta
-- y en ese caso el lookupReceiverByCode devuelve el primero registrado).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS encounter_code text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_encounter_code_idx
  ON public.profiles (encounter_code)
  WHERE encounter_code IS NOT NULL;
