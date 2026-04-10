/**
 * streakLogic.ts — fuente única de verdad para el sistema de Rachas de CALLE.
 *
 * Cualquier componente que necesite leer o escribir rachas debe importar desde aquí.
 * Nunca duplicar esta lógica en otros archivos.
 */

export const STREAK_KEY = 'calle_streak';

/** Km mínimos en una sesión para que cuente como día completado (fueguito activo). */
export const STREAK_MIN_KM = 1.0;

export interface StreakData {
  count: number;          // días consecutivos activos
  lastTs: number;         // epoch ms de la última sesión registrada
  lastDistanceKm: number; // km de la última sesión (para saber si completó el mínimo hoy)
}

export function loadStreak(): StreakData {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) return { count: 0, lastTs: 0, lastDistanceKm: 0 };
    const parsed = JSON.parse(raw) as Partial<StreakData>;
    return {
      count: parsed.count ?? 0,
      lastTs: parsed.lastTs ?? 0,
      lastDistanceKm: parsed.lastDistanceKm ?? 0,
    };
  } catch {
    return { count: 0, lastTs: 0, lastDistanceKm: 0 };
  }
}

export function isSameCalendarDay(tsA: number, tsB: number): boolean {
  const a = new Date(tsA);
  const b = new Date(tsB);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Retorna el recuento activo de racha.
 * Regla de Oro: si pasaron más de 48h desde lastTs → racha = 0.
 */
export function computeStreakCount(data: StreakData): number {
  if (data.lastTs === 0) return 0;
  const h48 = 48 * 60 * 60 * 1000;
  if (Date.now() - data.lastTs > h48) return 0;
  return data.count;
}

/**
 * Calcula el estado de la racha para mostrar en Home.
 * Lee directamente de localStorage para estar siempre actualizado al montar.
 */
export function getStreakDisplay(): { count: number; completedToday: boolean } {
  const data = loadStreak();
  const count = computeStreakCount(data);
  const completedToday =
    count > 0 &&
    isSameCalendarDay(data.lastTs, Date.now()) &&
    data.lastDistanceKm >= STREAK_MIN_KM;
  return { count, completedToday };
}

/**
 * Actualiza la racha al finalizar una sesión.
 * - Si ya hubo sesión hoy: refresca el timestamp y actualiza km si es mayor.
 * - Si es un día nuevo (y la racha no expiró): incrementa el contador.
 * Siempre persiste en localStorage.
 */
export function updateStreak(distanceKm: number): StreakData {
  const prev = loadStreak();
  const now = Date.now();
  const alreadyToday = prev.lastTs > 0 && isSameCalendarDay(prev.lastTs, now);

  const newStreak: StreakData = alreadyToday
    ? {
        count: prev.count,
        lastTs: now,
        lastDistanceKm: Math.max(prev.lastDistanceKm, distanceKm),
      }
    : {
        count: computeStreakCount(prev) + 1,
        lastTs: now,
        lastDistanceKm: distanceKm,
      };

  localStorage.setItem(STREAK_KEY, JSON.stringify(newStreak));
  return newStreak;
}
