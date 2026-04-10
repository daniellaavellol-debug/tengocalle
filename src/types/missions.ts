// ─── Misiones ─────────────────────────────────────────────────────────────────
// Soporta tanto el schema viejo (dificultad/condition_type) como el nuevo
// (difficulty/type/target_value) para compatibilidad con las 180 misiones de Supabase.

export type Difficulty = 'easy' | 'medium' | 'hard';
export type MissionType = 'distance' | 'speed' | 'social' | 'streak' | 'duration' | 'time_of_day';
export type MissionStatus = 'not_started' | 'in_progress' | 'completed';

export interface Mission {
  id: number;
  title: string;
  description: string;
  xp_reward: number;
  is_active: boolean;

  // Clasificación — el campo 'tribe' o 'category' según el schema
  tribe?: string;       // nuevo schema: 'Todas' | 'Ciclista' | 'Runner' | 'Roller'
  category?: string;    // legacy: mismo dominio de valores

  // Dificultad — 'difficulty' (nuevo) o 'dificultad' (legacy)
  difficulty?: Difficulty;
  dificultad?: string;  // legacy: 'facil' | 'media' | 'dificil'

  // Condición — nuevo schema
  type?: MissionType;
  target_value?: number;
  target_unit?: string;

  // Condición — legacy schema
  condition_type?: string;
  condition_value?: number;

  // Extras opcionales
  icon?: string;
  min_level?: number;
}

export interface UserMission {
  id: string;
  user_id: string;
  mission_id: number;
  status: MissionStatus;
  progress_value: number;   // valor actual (ej. 3.2 km de 5 km)
  completed_at: string | null;
  xp_earned: number;
  created_at: string;
}

export interface MissionWithProgress extends Mission {
  userMission: UserMission | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normaliza dificultad de cualquier schema al tipo canónico.
 *  Acepta cualquier casing y los valores legacy en español. */
export function normalizeDifficulty(m: Mission): Difficulty {
  // Tomar el primer campo que tenga valor, normalizar a minúsculas sin espacios
  const raw = (m.difficulty ?? m.dificultad ?? '').toLowerCase().trim();
  switch (raw) {
    case 'easy':
    case 'facil':
    case 'fácil':
      return 'easy';
    case 'medium':
    case 'media':
      return 'medium';
    case 'hard':
    case 'dificil':
    case 'difícil':
    case 'epica':
    case 'épica':
      return 'hard';
    default:
      return 'easy';
  }
}

/** Devuelve la tribu de la misión (soporta ambos schemas). */
export function missionTribe(m: Mission): string {
  return m.tribe ?? m.category ?? 'Todas';
}

/** Calcula el porcentaje de progreso (0–100). */
export function progressPercent(m: MissionWithProgress): number {
  const um = m.userMission;
  if (!um || um.status === 'not_started') return 0;
  if (um.status === 'completed') return 100;
  const target = m.target_value ?? m.condition_value ?? 1;
  return Math.min(100, Math.round((um.progress_value / target) * 100));
}

// ─── Colores de UI ────────────────────────────────────────────────────────────

export const TRIBE_COLORS: Record<string, { bg: string; text: string }> = {
  Ciclista: { bg: '#0047AB', text: '#ffffff' },
  Runner:   { bg: '#39FF14', text: '#000000' },
  Roller:   { bg: '#FFD700', text: '#000000' },
  Todas:    { bg: '#FF5F1F', text: '#000000' },
};

export const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  easy:   '#10B981',
  medium: '#F59E0B',
  hard:   '#EF4444',
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy:   'Fácil',
  medium: 'Media',
  hard:   'Épica',
};

export const TYPE_LABELS: Record<string, string> = {
  distance:    'Distancia',
  speed:       'Velocidad',
  social:      'Social',
  streak:      'Racha',
  duration:    'Duración',
  time_of_day: 'Horario',
};
