import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { trackMissionVoted } from '../providers/PostHogProvider';

export type VoteType = 'like' | 'dislike';

export interface MissionFeedbackHook {
  votes: Record<number, VoteType>;
  submitFeedback: (missionId: number, voteType: VoteType, userClass?: string) => Promise<void>;
  toastVisible: boolean;
}

/**
 * Gestiona el feedback de misiones (like/dislike) para un usuario.
 *
 * - Carga votos existentes de Supabase al montar.
 * - submitFeedback hace upsert (cambia voto) o delete (toggle off mismo voto).
 * - Actualización optimista: la UI responde de inmediato; se revierte si Supabase falla.
 * - Un usuario tiene máx. 1 registro por misión (UNIQUE user_id, mission_id en DB).
 */
export function useMissionFeedback(userId: string | null): MissionFeedbackHook {
  // Record<missionId, voteType> — solo misiones con voto activo
  const [votes, setVotes] = useState<Record<number, VoteType>>({});
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Carga inicial de votos del usuario ─────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    supabase
      .from('mission_feedback')
      .select('mission_id, vote_type')
      .eq('user_id', userId)
      .then(({ data }) => {
        if (!data?.length) return;
        const map: Record<number, VoteType> = {};
        for (const row of data) {
          map[row.mission_id as number] = row.vote_type as VoteType;
        }
        setVotes(map);
      });
  }, [userId]);

  // ── Toast helper ───────────────────────────────────────────────────────────
  const flashToast = () => {
    setToastVisible(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastVisible(false), 3000);
  };

  // ── submitFeedback ─────────────────────────────────────────────────────────
  const submitFeedback = async (missionId: number, voteType: VoteType, userClass = 'unknown'): Promise<void> => {
    if (!userId) return;

    const prevVote = votes[missionId];
    // Mismo voto → toggle off (null); voto diferente o nuevo → aplicar
    const nextVote: VoteType | null = prevVote === voteType ? null : voteType;

    // Actualización optimista — la UI responde antes de que llegue la respuesta de red
    setVotes(prev => {
      const updated = { ...prev };
      if (nextVote === null) delete updated[missionId];
      else updated[missionId] = nextVote;
      return updated;
    });

    if (nextVote === null) {
      // Borrar voto
      const { error } = await supabase
        .from('mission_feedback')
        .delete()
        .eq('user_id', userId)
        .eq('mission_id', missionId);

      if (error) {
        // Revertir si falló
        setVotes(prev => {
          if (prevVote !== undefined) return { ...prev, [missionId]: prevVote };
          const reverted = { ...prev };
          delete reverted[missionId];
          return reverted;
        });
      }
      // Registrar en analytics que el voto fue eliminado
      trackMissionVoted({ missionId, voteType: 'removed', userClass });
      // No mostramos toast al quitar voto
      return;
    }

    // Upsert: crea o actualiza el registro (UNIQUE user_id, mission_id en DB)
    const { error } = await supabase
      .from('mission_feedback')
      .upsert(
        { user_id: userId, mission_id: missionId, vote_type: nextVote },
        { onConflict: 'user_id,mission_id' },
      );

    if (error) {
      // Revertir al estado previo
      setVotes(prev => {
        const reverted = { ...prev };
        if (prevVote !== undefined) reverted[missionId] = prevVote;
        else delete reverted[missionId];
        return reverted;
      });
      console.warn('[useMissionFeedback] upsert failed:', error.message);
      return;
    }

    trackMissionVoted({ missionId, voteType: nextVote, userClass });
    flashToast();
  };

  return { votes, submitFeedback, toastVisible };
}
