import { supabase } from './supabase';

export interface Mission {
  id: number;
  title: string;
  description: string;
  icon: string;
  xp_reward: number;
  min_level: number;
  category: string;       // 'Todas' | 'Ciclista' | 'Runner' | 'Roller'
  condition_type: string; // 'distance_km' | 'duration_min' | 'hour_gte' | 'hour_lte' | 'encounter'
  condition_value: number;
}

export async function fetchMissions(): Promise<Mission[]> {
  const { data, error } = await supabase
    .from('missions')
    .select('*')
    .order('min_level', { ascending: true });
  if (error) { console.warn('[fetchMissions]', error.message); return []; }
  return (data ?? []) as Mission[];
}

interface SessionCtx {
  distanceKm: number;
  durationSec: number;
  startHour: number;
}

/** Devuelve las misiones de Supabase que esta sesión cumplió y que el usuario aún no tenía. */
export async function checkSessionMissions(
  ctx: SessionCtx,
  completedIds: number[],
  userLevel: number,
  userClass: string,
): Promise<{ bonusXp: number; newIds: number[] }> {
  const missions = await fetchMissions();
  const eligible = missions.filter(m => {
    if (completedIds.includes(m.id)) return false;             // ya completada
    if (m.min_level > userLevel) return false;                 // nivel insuficiente
    if (m.category !== 'Todas' && m.category !== userClass) return false; // otra clase
    return conditionMet(m, ctx);
  });

  return {
    bonusXp: eligible.reduce((sum, m) => sum + (m.xp_reward ?? 0), 0),
    newIds:  eligible.map(m => m.id),
  };
}

function conditionMet(m: Mission, ctx: SessionCtx): boolean {
  switch (m.condition_type) {
    case 'distance_km':  return ctx.distanceKm >= m.condition_value;
    case 'duration_min': return ctx.durationSec / 60 >= m.condition_value;
    case 'hour_gte':     return ctx.startHour >= m.condition_value;
    case 'hour_lte':     return ctx.startHour <= m.condition_value;
    default:             return false; // 'encounter' se maneja por separado
  }
}
