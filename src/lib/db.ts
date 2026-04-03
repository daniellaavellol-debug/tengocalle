import { supabase } from './supabase';
import type { UserData } from '../App';

/**
 * Sincroniza los datos del usuario con la tabla `users` en Supabase.
 * Usa upsert por `id` (UUID generado una sola vez y guardado en localStorage).
 *
 * Esquema requerido en Supabase:
 *   id         uuid  PRIMARY KEY
 *   name       text
 *   class      text
 *   multiplier float4
 *   total_xp   int4
 *   total_km   float4
 *   streak     int4
 *   encounters int4
 *   updated_at timestamptz  DEFAULT now()
 */
export async function syncUserData(user: UserData): Promise<void> {
  const id = getUserId();
  const { error } = await supabase.from('users').upsert({
    id,
    name:       user.name,
    class:      user.userClass,
    multiplier: user.multiplier,
    total_xp:   user.totalXp,
    total_km:   user.totalKm,
    streak:     user.streak,
    encounters: user.encounters,
    updated_at: new Date().toISOString(),
  });
  if (error) console.warn('[syncUserData]', error.message);
}

/** Genera o recupera un UUID estable para este dispositivo. */
function getUserId(): string {
  const KEY = 'calle_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}
