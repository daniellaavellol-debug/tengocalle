/**
 * handshakeService.ts — Códigos de encuentro, validación y registro de XP.
 *
 * Tablas:
 *   handshake_codes(user_id uuid PK, code text)           — directorio de códigos activos
 *   handshake_redemptions(redeemer_id, code_used, UNIQUE) — historial anti-duplicado
 *   actividades(user_id, xp_ganado, distancia, mision_conjunta) — fuente de verdad XP
 *   handshake_requests(initiator_id, receiver_id, status) — misiones conjuntas Realtime
 */

import { supabase } from '../lib/supabase';

// ─── Derivación de código estático ────────────────────────────────────────────

/**
 * Convierte el UUID del usuario en un código numérico de 4 dígitos (1000–9999).
 * Determinista: mismo userId → mismo código siempre.
 */
export function deriveEncounterCode(userId: string): string {
  const hex = userId.replace(/-/g, '');
  let n = 0;
  for (let i = 0; i < hex.length; i++) {
    n = (((n << 5) - n) + parseInt(hex[i], 16)) >>> 0;
  }
  return ((n % 9000) + 1000).toString();
}

// ─── Publicación de código ────────────────────────────────────────────────────

/**
 * UPSERT del código del usuario en `handshake_codes`.
 * Idempotente — se puede llamar en cada mount sin efectos secundarios.
 */
export async function ensureHandshakeCode(userId: string): Promise<void> {
  const code = deriveEncounterCode(userId);
  const { error } = await supabase
    .from('handshake_codes')
    .upsert({ user_id: userId, code }, { onConflict: 'user_id' });
  if (error) console.warn('[ensureHandshakeCode]', error.message);
}

/** @deprecated — usar ensureHandshakeCode */
export const ensureEncounterCode = ensureHandshakeCode;

// ─── Lookup del receptor ──────────────────────────────────────────────────────

/**
 * Busca el dueño de un código en `handshake_codes` y trae su perfil.
 * Retorna null si el código no existe.
 */
export async function lookupReceiverByCode(
  code: string,
): Promise<{ id: string; name: string; tribe: string } | null> {
  // 1. Resolver user_id desde el código
  const { data: codeRow, error: codeErr } = await supabase
    .from('handshake_codes')
    .select('user_id')
    .eq('code', code)
    .limit(1)
    .maybeSingle();

  if (codeErr || !codeRow) return null;

  const receiverId = codeRow.user_id as string;

  // 2. Traer nombre y tribu desde profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('name, tribe')
    .eq('id', receiverId)
    .maybeSingle();

  return {
    id:    receiverId,
    name:  (profile?.name  as string) ?? 'Callejero',
    tribe: (profile?.tribe as string) ?? '',
  };
}

// ─── Validación y registro de encuentro ──────────────────────────────────────

export type RedeemResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Valida y registra un encuentro callejero. Flujo:
 *
 *   1. Formato — debe ser exactamente 4 dígitos.
 *   2. Existencia — busca el código en `handshake_codes`; si no existe → error claro.
 *   3. Auto-canje — compara user_id del código con el del canjeador.
 *   4. Duplicado — consulta `handshake_redemptions`; aborta si ya existe.
 *   5. Registro — INSERT en `handshake_redemptions` (candado final via UNIQUE).
 *   6. XP — INSERT en `actividades` con mision_conjunta = true.
 *
 * @param redeemerUserId  UUID del usuario que ingresa el código
 * @param codeUsed        Código de 4 dígitos ingresado
 * @param xpToAward       XP a acreditar (200 primer encuentro, 50 resto)
 */
export async function redeemEncounterCode(
  redeemerUserId: string,
  codeUsed: string,
  xpToAward: number,
): Promise<RedeemResult> {
  // 1. Formato
  if (!/^\d{4}$/.test(codeUsed)) {
    return { ok: false, reason: 'Código inválido — ingresa 4 dígitos' };
  }

  // 2. Verificar que el código existe en handshake_codes
  const { data: codeRow, error: lookupErr } = await supabase
    .from('handshake_codes')
    .select('user_id')
    .eq('code', codeUsed)
    .limit(1)
    .maybeSingle();

  if (lookupErr) {
    console.warn('[redeemEncounterCode] lookup:', lookupErr.message);
    return { ok: false, reason: 'Error de red. Intenta de nuevo.' };
  }
  if (!codeRow) {
    return { ok: false, reason: 'Código no encontrado o vencido' };
  }

  // 3. Anti auto-canje — comparar user_id desde DB, no re-derivar
  if ((codeRow.user_id as string) === redeemerUserId) {
    return { ok: false, reason: 'No puedes usar tu propio código' };
  }

  // 4. Duplicado (pre-check para mensaje amigable)
  const { data: existing } = await supabase
    .from('handshake_redemptions')
    .select('id')
    .eq('redeemer_id', redeemerUserId)
    .eq('code_used', codeUsed)
    .limit(1);

  if ((existing ?? []).length > 0) {
    return { ok: false, reason: 'Ya has utilizado este código anteriormente' };
  }

  // 5. Registrar en handshake_redemptions (UNIQUE es el candado final)
  const { error: redemptionErr } = await supabase
    .from('handshake_redemptions')
    .insert({ redeemer_id: redeemerUserId, code_used: codeUsed });

  if (redemptionErr) {
    if (redemptionErr.code === '23505') {
      return { ok: false, reason: 'Ya has utilizado este código anteriormente' };
    }
    console.warn('[redeemEncounterCode] insert redemption:', redemptionErr.message);
    return { ok: false, reason: 'Error de red. Intenta de nuevo.' };
  }

  // 6. Acreditar XP en actividades (fuente de verdad)
  const { error: xpErr } = await supabase
    .from('actividades')
    .insert({
      user_id:         redeemerUserId,
      xp_ganado:       xpToAward,
      distancia:       0,
      mision_conjunta: true,
    });

  if (xpErr) console.warn('[redeemEncounterCode] insert actividades:', xpErr.message);
  // No abortamos por este error — el encuentro ya quedó registrado

  return { ok: true };
}

// ─── Misión conjunta Realtime ─────────────────────────────────────────────────

export interface HandshakeRequest {
  requestId: string;
  initiatorId: string;
  initiatorName: string;
}

/**
 * Inserta una solicitud de misión conjunta con status 'pending'.
 */
export async function createHandshakeRequest(
  initiatorId: string,
  initiatorName: string,
  receiverId: string,
): Promise<{ requestId: string } | { error: string }> {
  const { data, error } = await supabase
    .from('handshake_requests')
    .insert({ initiator_id: initiatorId, initiator_name: initiatorName, receiver_id: receiverId })
    .select('id')
    .single();
  if (error || !data) return { error: error?.message ?? 'unknown' };
  return { requestId: data.id as string };
}

/** Responde a una solicitud (Aceptar / Rechazar). */
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

/** Marca la solicitud como timeout (iniciador la cancela por vencimiento). */
export async function timeoutHandshakeRequest(requestId: string): Promise<void> {
  await supabase
    .from('handshake_requests')
    .update({ status: 'timeout' })
    .eq('id', requestId)
    .eq('status', 'pending');
}
