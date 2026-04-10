/**
 * useUserStats — Lee XP total del usuario desde la tabla `actividades`.
 * Filtra SIEMPRE por .eq('user_id', userId) para no sumar XP de otros usuarios.
 *
 * Esquema: actividades(user_id uuid, xp_ganado integer, distancia numeric)
 */
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface UserStats {
  totalXp: number;
  loading: boolean;
}

export function useUserStats(userId: string | null): UserStats {
  const [totalXp, setTotalXp] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    supabase
      .from('actividades')
      .select('xp_ganado')
      .eq('user_id', userId)          // ← columna real: user_id (no id_usuario)
      .then(({ data, error }) => {
        if (error) {
          console.warn('[useUserStats]', error.message);
        } else {
          const sum = (data ?? []).reduce(
            (acc: number, row: { xp_ganado: number | null }) => acc + (row.xp_ganado ?? 0),
            0,
          );
          setTotalXp(sum);
        }
        setLoading(false);
      });
  }, [userId]);                       // solo re-fetch si cambia el usuario

  return { totalXp, loading };
}
