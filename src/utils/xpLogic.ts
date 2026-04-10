/**
 * xpLogic.ts — Fórmula oficial de XP para CALLE.
 *
 * XP = [(km × factor_clase) + minutos_activos + bonus_mision + bonus_encuentro]
 *        × multiplicador_vuelta
 *
 * Nunca duplicar esta lógica. Importar siempre desde aquí.
 */

/** XP ganado por km según tribu. Runner tiene el factor más alto para compensar
 *  que corre distancias más cortas que un ciclista. */
export const CLASS_XP_FACTORS: Record<string, number> = {
  Runner:   12,
  Roller:    8,
  Ciclista:  5,
};

/** XP ganado por minuto de actividad (todas las tribus, sin multiplicador). */
export const TIME_XP_PER_MIN = 1;

/** Multiplicadores de vuelta (round) disponibles en el juego. */
export const ROUND_MULTIPLIERS = [1, 2, 4, 8] as const;

/** Bonus de encuentro callejero. */
export const ENCOUNTER_BONUS = {
  sameClass:  50,
  diffClass: 100,
  allThree:  200,
} as const;

export interface XpParams {
  distanceKm:      number;
  durationSec:     number;
  userClass:       string;
  roundMultiplier: number; // el multiplier que viene del perfil (V1=1, V2=2, V3=4, V4+=8)
  missionBonusXp:  number; // bonus de misiones (diaria + checkSessionMissions)
  encounterBonusXp: number; // bonus de encuentros en la sesión
}

/**
 * Calcula el XP total de una sesión según la fórmula oficial.
 * Todos los bonus se multiplican junto con la base (incentiva el multiplicador alto).
 */
export function calcTotalXp(p: XpParams): number {
  const factor  = CLASS_XP_FACTORS[p.userClass] ?? CLASS_XP_FACTORS.Roller;
  const minutes = p.durationSec / 60;
  const raw     = p.distanceKm * factor + minutes * TIME_XP_PER_MIN + p.missionBonusXp + p.encounterBonusXp;
  return Math.max(0, Math.round(raw * p.roundMultiplier));
}

/**
 * Cálculo rápido para el preview en HUD (sin bonuses aún conocidos).
 * No usar en el cálculo final real.
 */
export function calcXpPreview(distanceKm: number, durationSec: number, userClass: string, roundMultiplier: number): number {
  return calcTotalXp({ distanceKm, durationSec, userClass, roundMultiplier, missionBonusXp: 0, encounterBonusXp: 0 });
}
