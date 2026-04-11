/**
 * handshakeService.ts — CALLE v1.22
 * Servicio de "Encuentro Callejero" con diagnóstico de Rayos X
 *
 * Flujo:
 *   Usuario B (Emisor) → abre modal → genera código → guarda en handshake_codes → escucha Realtime
 *   Usuario A (Buscador) → ingresa código → lookup → confirma → crea encuentro → B recibe pop-up
 */

import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ─── Tipos ──────────────────────────────────────────────────────────────────

interface HandshakeCode {
  user_id: string;
  code: string;
  created_at?: string;
}

interface Encuentro {
  id?: string;
  user_a_id: string;
  user_b_id: string;
  code_used: string;
  xp_bonus: number;
  created_at?: string;
}

interface EncuentroCallback {
  (encuentro: Encuentro): void;
}

// ─── Constantes ─────────────────────────────────────────────────────────────

const CODE_LENGTH = 4;
const XP_POR_ENCUENTRO = 50;
// Los códigos son deterministas (mismo usuario = mismo código siempre),
// por lo que no vencen. Se deja un valor alto para no bloquear lookups.
const CODE_EXPIRY_MINUTES = 99999;

/**
 * Derivación interna determinista: UUID → 4 dígitos (1000–9999).
 * Idéntica al shim deriveEncounterCode exportado al final del archivo.
 * Mismo userId siempre produce el mismo código — fundamental para el lookup.
 */
function deriveEncounterCodeInternal(userId: string): string {
  const hex = userId.replace(/-/g, '');
  let n = 0;
  for (let i = 0; i < hex.length; i++) {
    n = (((n << 5) - n) + parseInt(hex[i], 16)) >>> 0;
  }
  return ((n % 9000) + 1000).toString();
}

/**
 * Valida que haya sesión activa. Retorna el userId o null.
 * Logea todo para diagnóstico.
 */
async function validateSession(): Promise<string | null> {
  console.log('[CALLE:Handshake] ── Validando sesión ──');

  const { data, error } = await supabase.auth.getUser();

  if (error) {
    console.error('[CALLE:Handshake] ❌ Error al obtener usuario:', {
      message: error.message,
      status: error.status,
    });
    return null;
  }

  if (!data.user) {
    console.error('[CALLE:Handshake] ❌ No hay usuario autenticado. getUser() retornó null.');
    console.error('[CALLE:Handshake] 💡 Hint: ¿El usuario hizo login? ¿Las cookies/tokens están presentes?');
    return null;
  }

  console.log('[CALLE:Handshake] ✅ Sesión válida:', {
    userId: data.user.id,
    email: data.user.email,
    provider: data.user.app_metadata?.provider,
  });

  return data.user.id;
}

// ─── USUARIO B: Generar y guardar código ────────────────────────────────────

/**
 * Genera un código de 4 dígitos, lo guarda en handshake_codes vía upsert,
 * y retorna el código para mostrar en la UI.
 *
 * DIAGNÓSTICO: Si el upsert falla silenciosamente, los logs mostrarán exactamente dónde.
 */
// Acepta userId opcional para compatibilidad con callers legacy — se ignora
// internamente porque validateSession() lo obtiene de auth.getUser().
export async function ensureHandshakeCode(_userId?: string): Promise<string | null> {
  console.log('[CALLE:Handshake] ═══════════════════════════════════════');
  console.log('[CALLE:Handshake] ensureHandshakeCode() — INICIO');

  // 1. Validar sesión
  const userId = await validateSession();
  if (!userId) {
    console.error('[CALLE:Handshake] ⛔ Abortando: sin sesión activa.');
    return null;
  }

  // 2. Derivar código determinista (mismo userId → mismo código siempre)
  // CRÍTICO: debe coincidir con deriveEncounterCode() que muestra la UI.
  const code = String(deriveEncounterCodeInternal(userId));

  // 3. Preparar payload — garantía de tipos
  const payload: HandshakeCode = {
    user_id: userId,         // UUID string
    code: String(code),      // TEXT — forzamos string explícito
  };

  console.log('[CALLE:Handshake] 📦 Payload a enviar:', JSON.stringify(payload, null, 2));
  console.log('[CALLE:Handshake] 📦 Tipos:', {
    user_id: typeof payload.user_id,
    code: typeof payload.code,
  });

  // 4. Upsert con captura completa de error
  try {
    console.log('[CALLE:Handshake] 🔄 Ejecutando upsert en handshake_codes...');

    const { data, error, status, statusText } = await supabase
      .from('handshake_codes')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();

    // Log completo de la respuesta
    console.log('[CALLE:Handshake] 📡 Respuesta Supabase:', {
      status,
      statusText,
      hasData: !!data,
      hasError: !!error,
    });

    if (error) {
      console.error('[CALLE:Handshake] ❌ ERROR en upsert:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      console.error('[CALLE:Handshake] 💡 Posibles causas:');
      console.error('  1. RLS bloqueando el INSERT/UPDATE (auth.uid() ≠ user_id)');
      console.error('  2. La tabla no existe o tiene otro nombre');
      console.error('  3. Columnas con nombres diferentes (case-sensitive)');
      console.error('  4. Constraint o trigger bloqueando la operación');
      return null;
    }

    if (!data) {
      console.warn('[CALLE:Handshake] ⚠️ Upsert OK pero sin data retornada.');
      console.warn('[CALLE:Handshake] 💡 Hint: RLS puede estar bloqueando el SELECT post-upsert.');
      console.warn('[CALLE:Handshake] El código se generó pero no se confirmó la escritura.');
      // Aún así retornamos el código — puede haberse escrito correctamente
      return code;
    }

    console.log('[CALLE:Handshake] ✅ Código guardado exitosamente:', data);
    console.log('[CALLE:Handshake] ═══════════════════════════════════════');
    return data.code;

  } catch (err) {
    console.error('[CALLE:Handshake] 💥 Excepción no controlada:', err);
    return null;
  }
}

// ─── USUARIO B: Suscribirse a encuentros (Realtime) ─────────────────────────

let realtimeChannel: RealtimeChannel | null = null;

/**
 * Usuario B se suscribe para recibir el pop-up instantáneo cuando
 * Usuario A confirma el encuentro.
 *
 * Escucha INSERTs en la tabla `encuentros` donde user_b_id = mi userId.
 */
export async function subscribeToEncuentros(
  onEncuentro: EncuentroCallback
): Promise<RealtimeChannel | null> {
  console.log('[CALLE:Handshake] 📡 Suscribiendo a encuentros Realtime...');

  const userId = await validateSession();
  if (!userId) {
    console.error('[CALLE:Handshake] ⛔ No se puede suscribir sin sesión.');
    return null;
  }

  // Limpiar suscripción previa si existe
  if (realtimeChannel) {
    console.log('[CALLE:Handshake] 🔄 Removiendo canal anterior...');
    await supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = supabase
    .channel(`encuentros:user_b:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'encuentros',
        filter: `user_b_id=eq.${userId}`,
      },
      (payload) => {
        console.log('[CALLE:Handshake] 🎉 ¡ENCUENTRO RECIBIDO!', payload.new);
        onEncuentro(payload.new as Encuentro);
      }
    )
    .subscribe((status) => {
      console.log('[CALLE:Handshake] 📡 Estado Realtime:', status);
      if (status === 'CHANNEL_ERROR') {
        console.error('[CALLE:Handshake] ❌ Error en canal Realtime.');
        console.error('[CALLE:Handshake] 💡 Verificar que Realtime esté habilitado en Supabase Dashboard.');
      }
    });

  return realtimeChannel;
}

/**
 * Limpia la suscripción Realtime (llamar al cerrar el modal o desmontar).
 */
export async function unsubscribeFromEncuentros(): Promise<void> {
  if (realtimeChannel) {
    console.log('[CALLE:Handshake] 🔌 Desuscribiendo de encuentros...');
    await supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

// ─── USUARIO A: Buscar código (Lookup) ──────────────────────────────────────

/**
 * Usuario A ingresa el código de 4 dígitos.
 * Retorna el user_id del Usuario B si el código existe y es válido.
 */
export async function lookupCode(code: string): Promise<{
  found: boolean;
  userBId: string | null;
  error: string | null;
}> {
  console.log('[CALLE:Handshake] 🔍 Buscando código:', code);

  const userId = await validateSession();
  if (!userId) {
    return { found: false, userBId: null, error: 'Sin sesión activa' };
  }

  // Sanitizar código
  const sanitizedCode = String(code).trim();
  if (sanitizedCode.length !== CODE_LENGTH || !/^\d+$/.test(sanitizedCode)) {
    console.warn('[CALLE:Handshake] ⚠️ Código inválido:', sanitizedCode);
    return { found: false, userBId: null, error: 'Código debe ser 4 dígitos' };
  }

  try {
    const { data, error } = await supabase
      .from('handshake_codes')
      .select('user_id, code, created_at')
      .eq('code', sanitizedCode)
      .maybeSingle();  // null cuando no existe — no lanza error como .single()

    if (error) {
      console.error('[CALLE:Handshake] ❌ Error en lookup:', { message: error.message, code: error.code, hint: error.hint });
      return { found: false, userBId: null, error: 'Error consultando el código' };
    }

    if (!data) {
      console.log('[CALLE:Handshake] 🔍 Código no encontrado:', sanitizedCode);
      return { found: false, userBId: null, error: 'Código no encontrado' };
    }

    // Verificar que no sea el mismo usuario
    if (data.user_id === userId) {
      console.warn('[CALLE:Handshake] ⚠️ Usuario intentó usar su propio código.');
      return { found: false, userBId: null, error: 'No puedes encontrarte a ti mismo' };
    }

    // Verificar expiración (opcional pero recomendado)
    if (data.created_at) {
      const createdAt = new Date(data.created_at);
      const now = new Date();
      const diffMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);
      if (diffMinutes > CODE_EXPIRY_MINUTES) {
        console.warn('[CALLE:Handshake] ⏰ Código expirado:', {
          createdAt: data.created_at,
          minutesAgo: Math.round(diffMinutes),
        });
        return { found: false, userBId: null, error: 'Código expirado' };
      }
    }

    console.log('[CALLE:Handshake] ✅ Código encontrado. User B:', data.user_id);
    return { found: true, userBId: data.user_id, error: null };

  } catch (err) {
    console.error('[CALLE:Handshake] 💥 Excepción en lookup:', err);
    return { found: false, userBId: null, error: 'Error inesperado' };
  }
}

// ─── USUARIO A: Confirmar encuentro ─────────────────────────────────────────

/**
 * Usuario A confirma el encuentro.
 * Inserta en encuentros con status='pending' → Realtime → B recibe pop-up.
 * Otorga XP BASE (+50) a ambos. El bonus (+50 extra) llega si B acepta.
 * Retorna encuentroId para que A pueda suscribirse a la respuesta de B.
 */
export async function confirmEncuentro(
  userBId: string,
  codeUsed: string,
): Promise<{ success: boolean; error: string | null; encuentroId?: string }> {
  console.log('[CALLE:Handshake] 🤝 Confirmando encuentro...');

  const userAId = await validateSession();
  if (!userAId) return { success: false, error: 'Sin sesión activa' };

  // Anti-duplicado: un encuentro por par en 24 h
  const { data: existing } = await supabase
    .from('encuentros')
    .select('id')
    .or(`and(user_a_id.eq.${userAId},user_b_id.eq.${userBId}),and(user_a_id.eq.${userBId},user_b_id.eq.${userAId})`)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(1);

  if (existing && existing.length > 0) {
    console.warn('[CALLE:Handshake] ⚠️ Encuentro duplicado en últimas 24 h.');
    return { success: false, error: 'Ya tuviste un encuentro con este callejero hoy' };
  }

  const payload = {
    user_a_id: userAId,
    user_b_id: userBId,
    code_used: String(codeUsed),
    xp_bonus:  XP_POR_ENCUENTRO,
    status:    'pending',
  };

  console.log('[CALLE:Handshake] 📦 Payload encuentro:', JSON.stringify(payload, null, 2));

  const { data, error, status } = await supabase
    .from('encuentros')
    .insert(payload)
    .select('id')
    .single();

  console.log('[CALLE:Handshake] 📡 Respuesta insert:', { status, hasData: !!data, hasError: !!error });

  if (error) {
    console.error('[CALLE:Handshake] ❌ Error al crear encuentro:', {
      message: error.message, code: error.code, hint: error.hint,
    });
    return { success: false, error: 'No se pudo registrar el encuentro' };
  }

  const encuentroId = (data as { id: string }).id;
  console.log('[CALLE:Handshake] ✅ Encuentro creado — id:', encuentroId);

  // XP BASE garantizado para ambos (independientemente de si B acepta)
  await grantXP(userAId, XP_POR_ENCUENTRO);
  await grantXP(userBId, XP_POR_ENCUENTRO);

  return { success: true, error: null, encuentroId };
}

// ─── USUARIO B: Aceptar encuentro ────────────────────────────────────────────

/**
 * B acepta la misión conjunta.
 * Actualiza status → 'accepted' y otorga XP BONUS (+50 extra) a ambos.
 */
export async function acceptEncuentro(
  encuentroId: string,
): Promise<{ success: boolean; error: string | null }> {
  console.log('[CALLE:Handshake] ✅ acceptEncuentro —', encuentroId);

  const userId = await validateSession();
  if (!userId) return { success: false, error: 'Sin sesión activa' };

  // Verificar que el encuentro existe, que yo soy B y que está pending
  const { data: enc, error: fetchErr } = await supabase
    .from('encuentros')
    .select('user_a_id, user_b_id, status')
    .eq('id', encuentroId)
    .single();

  if (fetchErr || !enc) {
    console.error('[CALLE:Handshake] ❌ Encuentro no encontrado:', fetchErr?.message);
    return { success: false, error: 'Encuentro no encontrado' };
  }
  if ((enc.user_b_id as string) !== userId) {
    console.error('[CALLE:Handshake] ❌ No eres el receptor de este encuentro');
    return { success: false, error: 'No autorizado' };
  }
  if ((enc.status as string) !== 'pending') {
    console.warn('[CALLE:Handshake] ⚠️ Encuentro ya procesado:', enc.status);
    return { success: false, error: 'El encuentro ya fue procesado' };
  }

  const { error: updErr } = await supabase
    .from('encuentros')
    .update({ status: 'accepted' })
    .eq('id', encuentroId);

  if (updErr) {
    console.error('[CALLE:Handshake] ❌ Error al aceptar:', {
      message: updErr.message, code: updErr.code, hint: updErr.hint,
    });
    return { success: false, error: 'No se pudo actualizar el encuentro' };
  }

  console.log('[CALLE:Handshake] 🎉 Encuentro aceptado — otorgando XP bonus...');
  // XP BONUS: +50 extra a cada uno (total = 100 por encuentro)
  await grantXP(enc.user_a_id as string, XP_POR_ENCUENTRO);
  await grantXP(enc.user_b_id as string, XP_POR_ENCUENTRO);

  return { success: true, error: null };
}

// ─── USUARIO B: Rechazar encuentro ───────────────────────────────────────────

/**
 * B rechaza la misión conjunta (o el sistema la expira por timeout).
 * NO otorga XP adicional — ambos se quedan con el XP base.
 */
export async function rejectEncuentro(
  encuentroId: string,
  reason: 'rejected' | 'expired' = 'rejected',
): Promise<{ success: boolean; error: string | null }> {
  console.log(`[CALLE:Handshake] ❌ rejectEncuentro (${reason}) —`, encuentroId);

  const userId = await validateSession();
  if (!userId) return { success: false, error: 'Sin sesión activa' };

  const { error } = await supabase
    .from('encuentros')
    .update({ status: reason })
    .eq('id', encuentroId)
    .eq('user_b_id', userId);  // solo B puede rechazar/expirar

  if (error) {
    console.error('[CALLE:Handshake] ❌ Error al rechazar encuentro:', {
      message: error.message, code: error.code, hint: error.hint,
    });
    return { success: false, error: error.message };
  }

  console.log(`[CALLE:Handshake] Encuentro marcado como '${reason}'`);
  return { success: true, error: null };
}

// ─── USUARIO A: Suscribirse a la respuesta de B ───────────────────────────────

/**
 * A se suscribe a cambios en su encuentro para saber si B aceptó o rechazó.
 * Retorna el canal para que el caller pueda limpiarlo al desmontar.
 */
export function subscribeToEncuentroUpdates(
  encuentroId: string,
  onUpdate: (payload: { id: string; status: string; user_a_id: string; user_b_id: string }) => void,
): RealtimeChannel {
  console.log('[CALLE:Handshake] 📡 Suscribiendo a updates del encuentro:', encuentroId);

  const channel = supabase
    .channel(`encuentro:update:${encuentroId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'encuentros', filter: `id=eq.${encuentroId}` },
      (event) => {
        const row = event.new as { id: string; status: string; user_a_id: string; user_b_id: string };
        console.log('[CALLE:Handshake] 📬 Update recibido:', row);
        onUpdate(row);
      },
    )
    .subscribe((status) => {
      console.log('[CALLE:Handshake] 📡 Canal update estado:', status);
    });

  return channel;
}

// ─── XP ─────────────────────────────────────────────────────────────────────

/**
 * Incrementa XP del usuario.
 * Usa la fórmula: PC = (Base × Multiplicador_Clase) × (1 + Racha/10)
 * Pero para encuentros el bonus es fijo (XP_POR_ENCUENTRO), sin multiplicador.
 */
async function grantXP(userId: string, xp: number): Promise<void> {
  console.log(`[CALLE:Handshake] 💰 Otorgando ${xp} XP a ${userId.slice(0, 8)}...`);

  const { error } = await supabase.rpc('increment_xp', {
    p_user_id: userId,
    p_amount: xp,
  });

  if (error) {
    console.error(`[CALLE:Handshake] ❌ Error al otorgar XP a ${userId.slice(0, 8)}:`, {
      message: error.message,
      hint: error.hint,
    });
    console.error('[CALLE:Handshake] 💡 ¿Existe la función RPC increment_xp en Supabase?');
  } else {
    console.log(`[CALLE:Handshake] ✅ XP otorgado a ${userId.slice(0, 8)}`);
  }
}

// ─── SQL necesario (referencia) ─────────────────────────────────────────────
/*

-- Si la tabla handshake_codes no tiene created_at, agregarlo:
ALTER TABLE handshake_codes
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Tabla encuentros (si no existe):
CREATE TABLE IF NOT EXISTS encuentros (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_a_id UUID REFERENCES auth.users(id) NOT NULL,
  user_b_id UUID REFERENCES auth.users(id) NOT NULL,
  code_used TEXT NOT NULL,
  xp_bonus INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS para encuentros:
ALTER TABLE encuentros ENABLE ROW LEVEL SECURITY;

-- Cualquier autenticado puede insertar (Usuario A crea el registro)
CREATE POLICY "Authenticated users can insert encuentros"
ON encuentros FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_a_id);

-- Ambos participantes pueden ver sus encuentros
CREATE POLICY "Users can view their encuentros"
ON encuentros FOR SELECT
TO authenticated
USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

-- Habilitar Realtime en la tabla (IMPORTANTE para el pop-up):
ALTER PUBLICATION supabase_realtime ADD TABLE encuentros;

-- Función RPC para incrementar XP (si no existe):
CREATE OR REPLACE FUNCTION increment_xp(p_user_id UUID, p_amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET xp = COALESCE(xp, 0) + p_amount,
      updated_at = now()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

*/

// ─── Compatibilidad con callers v1.21 ───────────────────────────────────────
// Estos exports permiten que MapboxTracking, EncounterModal, useHandshake,
// useHandshakeListener y useGlobalHandshake sigan compilando sin cambios.

/** Código determinista desde UUID (djb2 hash → 1000–9999). Nunca cambia. */
export function deriveEncounterCode(userId: string): string {
  const hex = userId.replace(/-/g, '');
  let n = 0;
  for (let i = 0; i < hex.length; i++) {
    n = (((n << 5) - n) + parseInt(hex[i], 16)) >>> 0;
  }
  return ((n % 9000) + 1000).toString();
}

/** @deprecated — alias de ensureHandshakeCode */
export const ensureEncounterCode = ensureHandshakeCode;

/** Resultado de canje de código. Incluye encuentroId en éxito para subscriptions. */
export type RedeemResult =
  | { ok: true;  encuentroId: string }
  | { ok: false; reason: string };

/**
 * Busca el dueño de un código y trae su perfil.
 * Wrapper sobre lookupCode para compatibilidad con callers v1.21.
 */
export async function lookupReceiverByCode(
  code: string,
): Promise<{ id: string; name: string; tribe: string } | null> {
  const result = await lookupCode(code);
  if (!result.found || !result.userBId) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, tribe')
    .eq('id', result.userBId)
    .maybeSingle();

  return {
    id:    result.userBId,
    name:  (profile?.name  as string) ?? 'Callejero',
    tribe: (profile?.tribe as string) ?? '',
  };
}

/**
 * Valida y registra un encuentro. Wrapper para compatibilidad con EncounterModal v1.21.
 */
export async function redeemEncounterCode(
  _redeemerUserId: string,
  codeUsed: string,
  _xpToAward: number,
): Promise<RedeemResult> {
  if (!/^\d{4}$/.test(codeUsed)) {
    return { ok: false, reason: 'Código inválido — ingresa 4 dígitos' };
  }

  const lookup = await lookupCode(codeUsed);
  if (!lookup.found || !lookup.userBId) {
    return { ok: false, reason: lookup.error ?? 'Código no encontrado o vencido' };
  }

  const outcome = await confirmEncuentro(lookup.userBId, codeUsed);
  if (!outcome.success) {
    if (outcome.error?.includes('duplicado') || outcome.error?.includes('hoy')) {
      return { ok: false, reason: 'Ya has utilizado este código anteriormente' };
    }
    return { ok: false, reason: outcome.error ?? 'Error de red. Intenta de nuevo.' };
  }

  return { ok: true, encuentroId: outcome.encuentroId! };
}

/** Tipo de solicitud de misión conjunta (Realtime). */
export interface HandshakeRequest {
  requestId:     string;
  initiatorId:   string;
  initiatorName: string;
}

/**
 * Inserta una solicitud de misión conjunta en handshake_requests.
 * Mantiene la tabla handshake_requests para el flujo Realtime de invitaciones.
 */
export async function createHandshakeRequest(
  initiatorId:   string,
  initiatorName: string,
  receiverId:    string,
): Promise<{ requestId: string } | { error: string }> {
  const { data, error } = await supabase
    .from('handshake_requests')
    .insert({ initiator_id: initiatorId, initiator_name: initiatorName, receiver_id: receiverId })
    .select('id')
    .single();
  if (error || !data) return { error: error?.message ?? 'unknown' };
  return { requestId: data.id as string };
}

/** Responde a una solicitud de misión conjunta (Aceptar / Rechazar). */
export async function respondToHandshake(
  requestId: string,
  status: 'accepted' | 'rejected',
): Promise<void> {
  const { error } = await supabase
    .from('handshake_requests')
    .update({ status })
    .eq('id', requestId);
  if (error) console.warn('[respondToHandshake]', error.message);
}
