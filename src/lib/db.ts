import { supabase } from './supabase';
import type { UserData } from '../App';

/**
 * Sincroniza total_km y xp con la tabla `profiles`.
 * La tabla profiles tiene: id, name, tribe, updated_at, encounter_code, total_km, xp.
 * streak y encounters son solo locales (no existen en profiles).
 * XP proviene de actividades.xp_ganado (fuente de verdad); aquí se denormaliza
 * en profiles.xp para lecturas rápidas.
 */
export async function syncUserData(user: UserData): Promise<void> {
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return;

  const { error } = await supabase.from('profiles').upsert({
    id:         authUser.id,
    name:       user.name,
    total_km:   user.totalKm,
    xp:         user.totalXp,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  if (error) console.warn('[syncUserData]', error.message);
}
