import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Mission, UserMission, MissionWithProgress } from '../types/missions';

// ─── Helpers de query ─────────────────────────────────────────────────────────

/**
 * Genera el string OR para Supabase que cubre todos los casos de tribu:
 *   - Tribu del usuario (ilike = case-insensitive)
 *   - Misiones universales: 'all', 'todas' (inglés/español, cualquier casing)
 *   - Mismo chequeo para el campo legacy 'category'
 *
 * Por qué ilike y no eq: PostgREST eq es case-sensitive.
 * La DB puede tener 'ciclista' o 'Ciclista'; ilike matchea ambos.
 */
function tribeOrFilter(tribe: string): string {
  const t = tribe.toLowerCase().trim();
  return [
    `tribe.ilike.${t}`,
    `tribe.ilike.all`,
    `tribe.ilike.todas`,
    `category.ilike.${t}`,
    `category.ilike.all`,
    `category.ilike.todas`,
  ].join(',');
}

// ─── fetchMissionOfDay ────────────────────────────────────────────────────────

/** Seed determinista por fecha → misma misión para todos los usuarios ese día. */
function todaySeed(): number {
  const d = new Date();
  return parseInt(
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`,
    10,
  );
}

export async function fetchMissionOfDay(tribe: string): Promise<Mission | null> {
  const { data, error } = await supabase
    .from('missions')
    .select('*')
    .or(tribeOrFilter(tribe))
    .or('difficulty.ilike.easy,dificultad.ilike.facil,dificultad.ilike.fácil')
    .eq('is_active', true)
    .order('id', { ascending: true });

  if (error || !data?.length) return null;
  return (data as Mission[])[todaySeed() % data.length];
}

// ─── useMissions hook ─────────────────────────────────────────────────────────

interface UseMissionsReturn {
  missions: MissionWithProgress[];
  loading: boolean;
  error: string | null;
  updateMissionProgress: (missionId: number, progressValue: number) => Promise<void>;
  completeMission: (missionId: number, xpEarned: number) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useMissions(userId: string | null): UseMissionsReturn {
  const [missions, setMissions] = useState<MissionWithProgress[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    setError(null);

    // Modo catálogo abierto: trae TODAS las misiones sin filtrar por tribu.
    const { data: mData, error: mErr } = await supabase
      .from('missions')
      .select('*')
      .order('created_at', { ascending: false });

    if (mErr) { setError(mErr.message); setLoading(false); return; }

    // Progreso del usuario en esas misiones
    const missionIds = (mData ?? []).map((m: Mission) => m.id);
    const { data: umData } = missionIds.length
      ? await supabase
          .from('user_missions')
          .select('*')
          .eq('user_id', userId)
          .in('mission_id', missionIds)
      : { data: [] };

    const umMap = new Map<number, UserMission>(
      (umData ?? []).map((um: UserMission) => [um.mission_id, um]),
    );

    setMissions(
      (mData ?? []).map((m: Mission) => ({ ...m, userMission: umMap.get(m.id) ?? null })),
    );
    setLoading(false);
  }, [userId]);

  useEffect(() => { refetch(); }, [refetch]);

  // ─── Mutaciones ──────────────────────────────────────────────────────────────
  const updateMissionProgress = async (missionId: number, progressValue: number) => {
    if (!userId) return;
    const { error } = await supabase.from('user_missions').upsert(
      { user_id: userId, mission_id: missionId, status: 'in_progress', progress_value: progressValue },
      { onConflict: 'user_id,mission_id' },
    );
    if (error) { console.warn('[updateMissionProgress]', error.message); return; }
    setMissions(prev => prev.map(m =>
      m.id !== missionId ? m : {
        ...m,
        userMission: {
          ...(m.userMission ?? { id: '', user_id: userId, mission_id: missionId, completed_at: null, xp_earned: 0, created_at: '' }),
          status: 'in_progress' as const,
          progress_value: progressValue,
        },
      },
    ));
  };

  const completeMission = async (missionId: number, xpEarned: number) => {
    if (!userId) return;
    const now = new Date().toISOString();
    const { error } = await supabase.from('user_missions').upsert(
      {
        user_id: userId, mission_id: missionId, status: 'completed',
        progress_value: 100, completed_at: now, xp_earned: xpEarned,
      },
      { onConflict: 'user_id,mission_id' },
    );
    if (error) { console.warn('[completeMission]', error.message); return; }
    setMissions(prev => prev.map(m =>
      m.id !== missionId ? m : {
        ...m,
        userMission: {
          ...(m.userMission ?? { id: '', user_id: userId, mission_id: missionId, created_at: '' }),
          status: 'completed' as const,
          progress_value: 100,
          completed_at: now,
          xp_earned: xpEarned,
        },
      },
    ));
  };

  return { missions, loading, error, updateMissionProgress, completeMission, refetch };
}

// ─── Helpers exportados para MapboxTracking ───────────────────────────────────

/** Registra progreso de múltiples misiones al terminar una sesión (fire-and-forget). */
export async function batchUpdateProgress(
  userId: string,
  updates: Array<{ missionId: number; progressValue: number; completed: boolean; xpEarned: number }>,
): Promise<void> {
  if (!updates.length) return;
  const rows = updates.map(u => ({
    user_id:        userId,
    mission_id:     u.missionId,
    status:         u.completed ? 'completed' : 'in_progress',
    progress_value: u.progressValue,
    completed_at:   u.completed ? new Date().toISOString() : null,
    xp_earned:      u.completed ? u.xpEarned : 0,
  }));
  const { error } = await supabase
    .from('user_missions')
    .upsert(rows, { onConflict: 'user_id,mission_id' });
  if (error) console.warn('[batchUpdateProgress]', error.message);
}

/** Devuelve las misiones activas de la tribu sin montar el hook. */
export async function fetchMissionsByTribe(tribe: string): Promise<Mission[]> {
  const { data, error } = await supabase
    .from('missions')
    .select('*')
    .or(tribeOrFilter(tribe))
    .order('id', { ascending: true });
  if (error) { console.warn('[fetchMissionsByTribe]', error.message); return []; }
  return (data ?? []) as Mission[];
}

/** Filtra misiones de una tribu por progreso de sesión y marca las completadas. */
export function evaluateSessionMissions(
  missions: Mission[],
  ctx: { distanceKm: number; durationSec: number; startHour: number },
  alreadyCompletedIds: number[],
): Array<{ mission: Mission; completed: boolean }> {
  return missions
    .filter(m => !alreadyCompletedIds.includes(m.id))
    .map(m => {
      const target = m.target_value ?? m.condition_value ?? 0;
      const type   = m.type ?? m.condition_type ?? '';
      let progress = 0;
      switch (type) {
        case 'distance':    case 'distance_km':  progress = ctx.distanceKm;       break;
        case 'duration':    case 'duration_min': progress = ctx.durationSec / 60; break;
        case 'time_of_day': case 'hour_gte':     progress = ctx.startHour;        break;
        default: return null;
      }
      return { mission: m, completed: progress >= target };
    })
    .filter(Boolean) as Array<{ mission: Mission; completed: boolean }>;
}
