/**
 * useHandshakeListener — Escucha solicitudes de misión conjunta entrantes.
 *
 * Usa Supabase Realtime (Postgres Changes) para detectar INSERT en
 * handshake_requests WHERE receiver_id = userId. Cuando llega una solicitud
 * 'pending', dispara el callback onIncoming.
 *
 * RLS requerida: el receptor debe tener SELECT en handshake_requests donde
 * receiver_id = auth.uid() (ver sql/handshake_requests.sql).
 */

import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { ensureEncounterCode, type HandshakeRequest } from '../services/handshakeService';

export { type HandshakeRequest };

export function useHandshakeListener(
  userId: string | null,
  onIncoming: (req: HandshakeRequest) => void,
) {
  const callbackRef = useRef(onIncoming);
  useEffect(() => { callbackRef.current = onIncoming; }, [onIncoming]);

  useEffect(() => {
    if (!userId) return;

    // Garantizar que nuestro código esté publicado en profiles antes de
    // suscribirnos — así, si alguien busca nuestro código justo ahora, lo encuentra.
    void ensureEncounterCode(userId);

    const channel = supabase
      .channel(`hs:rx:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'handshake_requests',
          filter: `receiver_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            initiator_id: string;
            initiator_name: string;
            status: string;
          };
          if (row.status === 'pending') {
            callbackRef.current({
              requestId:     row.id,
              initiatorId:   row.initiator_id,
              initiatorName: row.initiator_name ?? 'Callejero',
            });
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);
}

/**
 * watchHandshakeResponse — Suscribe al UPDATE de un request específico.
 * Llamada por el iniciador (A) después de crear la solicitud.
 *
 * @returns cleanup — llamar al cancelar/desmontar
 */
export function watchHandshakeResponse(
  requestId: string,
  onAccepted: () => void,
  onRejected: () => void,
): () => void {
  const channel = supabase
    .channel(`hs:tx:${requestId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'handshake_requests',
        filter: `id=eq.${requestId}`,
      },
      (payload) => {
        const status = (payload.new as { status: string }).status;
        if (status === 'accepted') onAccepted();
        else if (status === 'rejected') onRejected();
      },
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
