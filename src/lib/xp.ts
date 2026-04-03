/** 1000 XP por nivel. Nivel mínimo: 1. */
export function calculateLevel(xp: number): number {
  return Math.floor(xp / 1000) + 1;
}

export function xpForNextLevel(xp: number): { current: number; needed: number; progress: number } {
  const remainder = xp % 1000;
  return { current: remainder, needed: 1000, progress: (remainder / 1000) * 100 };
}
