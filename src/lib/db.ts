import { supabase } from './supabase';
import type { UserData } from '../App';

/**
 * Sincroniza km, racha y encuentros con la tabla `users`.
 * XP NO se escribe aquí — la fuente de verdad es actividades.xp_ganado.
 *
 * Esquema requerido (tabla `users`):
 *   id         uuid  PRIMARY KEY REFERENCES auth.users(id)
 *   name       text
 *   class      text
 *   multiplier float4
 *   total_km   float4
 *   streak     int4
 *   encounters int4
 *   updated_at timestamptz  DEFAULT now()
 */
export async function syncUserData(user: UserData): Promise<void> {
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return;

  const { error } = await supabase.from('users').upsert({
    id:         authUser.id,
    name:       user.name,
    class:      user.userClass,
    multiplier: user.multiplier,
    total_km:   user.totalKm,
    streak:     user.streak,
    encounters: user.encounters,
    updated_at: new Date().toISOString(),
  });

  if (error) console.warn('[syncUserData]', error.message);
}
