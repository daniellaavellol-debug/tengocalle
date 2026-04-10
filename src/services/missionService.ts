/**
 * missionService.ts — Motor de Misión Diaria para CALLE.
 *
 * Esquema Supabase requerido para user_missions:
 *   user_id      uuid        NOT NULL  (referencia a users.id)
 *   mission_id   int4        NOT NULL
 *   completed_at timestamptz DEFAULT now()
 *   distance_km  float4      (km recorridos en la sesión que la completó)
 *
 * La tabla missions debe tener la columna dificultad text ('facil' | 'media' | 'dificil').
 */

import { supabase } from '../lib/supabase';
import type { Mission } from '../lib/missions';

export interface DailyMission {
  mission: Mission;
  alreadyCompleted: boolean; // true si el usuario ya la completó HOY antes de esta sesión
}

/** Devuelve "YYYY-MM-DD" en zona local. */
function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Selecciona la misión del día para el usuario usando un seed basado en la fecha.
 * La misión rota cada medianoche y es la misma para todos los usuarios de la misma clase.
 *
 * @param userClass  Tribu del usuario ('Runner' | 'Ciclista' | 'Roller')
 * @returns          La misión del día y si el usuario ya la completó, o null si hay error de red.
 */
export async function getMisionDelDia(userClass: string): Promise<DailyMission | null> {
  try {
    // 1. Buscar misiones 'facil' de la clase del usuario (o 'Todas')
    const { data: missions, error: mError } = await supabase
      .from('missions')
      .select('*')
      .in('category', [userClass, 'Todas'])
      .eq('dificultad', 'facil')
      .order('id', { ascending: true });

    if (mError) {
      console.warn('[getMisionDelDia] Error fetching missions:', mError.message);
      return null;
    }

    const pool = (missions ?? []) as Mission[];
    if (pool.length === 0) return null;

    // 2. Seed determinista: date string → número → índice estable por día
    const seed = parseInt(todayString().replace(/-/g, ''), 10); // ej. 20260408
    const mission = pool[seed % pool.length];

    // 3. Verificar si el usuario ya completó esta misión hoy
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null; // Sin sesión no podemos verificar
    const userId = user.id;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: existing, error: umError } = await supabase
      .from('user_missions')
      .select('mission_id')
      .eq('user_id', userId)
      .eq('mission_id', mission.id)
      .gte('completed_at', todayStart.toISOString())
      .limit(1);

    if (umError) {
      console.warn('[getMisionDelDia] Error checking user_missions:', umError.message);
      // Seguimos: no bloquear el juego por este error, asumir no completada
    }

    return {
      mission,
      alreadyCompleted: (existing ?? []).length > 0,
    };
  } catch (err) {
    console.warn('[getMisionDelDia] Unexpected error:', err);
    return null;
  }
}

/**
 * Registra que el usuario completó la misión del día.
 * Silencia errores de red — el XP ya se aplicó localmente.
 */
export async function completeDailyMission(missionId: number, distanceKm: number): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // Sin sesión no registramos
    const { error } = await supabase.from('user_missions').insert({
      user_id:      user.id,
      mission_id:   missionId,
      completed_at: new Date().toISOString(),
      distance_km:  distanceKm,
    });
    if (error) console.warn('[completeDailyMission]', error.message);
  } catch (err) {
    console.warn('[completeDailyMission] Unexpected error:', err);
  }
}

/**
 * Verifica si las condiciones de la sesión cumplen el objetivo de la misión.
 * Reutiliza la misma lógica de conditionMet de lib/missions.ts pero sin importar todo.
 */
export function missionConditionMet(
  mission: Mission,
  ctx: { distanceKm: number; durationSec: number; startHour: number },
): boolean {
  switch (mission.condition_type) {
    case 'distance_km':  return ctx.distanceKm >= mission.condition_value;
    case 'duration_min': return ctx.durationSec / 60 >= mission.condition_value;
    case 'hour_gte':     return ctx.startHour >= mission.condition_value;
    case 'hour_lte':     return ctx.startHour <= mission.condition_value;
    default:             return false;
  }
}
