/**
 * useGlobalHandshake — Canal Realtime global para invitaciones de Misión Conjunta.
 *
 * Escucha INSERT en handshake_requests WHERE receiver_id = userId.
 * Se desactiva (userId = null) cuando el usuario está en el mapa para evitar
 * duplicar el canal que ya tiene MapboxTracking/useHandshakeListener.
 *
 * Flujo receptor (B):
 *   INSERT detectado → setIncoming → modal en App.tsx
 *   accept()        → respondToHandshake('accepted') → onAccepted() → navegar al mapa
 *   reject()        → respondToHandshake('rejected') → +50 XP base en actividades
 *
 * Limpieza: removeChannel al desmontar o cuando userId cambia a null.
 */

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { respondToHandshake } from '../services/handshakeService';

export interface IncomingHandshake {
  requestId:     string;
  initiatorId:   string;
  initiatorName: string;
}

interface UseGlobalHandshakeReturn {
  incoming:  IncomingHandshake | null;
  accepting: boolean;
  accept:    () => Promise<void>;
  reject:    () => Promise<void>;
}

export function useGlobalHandshake(
  userId: string | null,   // pasar null cuando step === 'map' para deshabilitar
  onAccepted: () => void,  // callback que navega al mapa
): UseGlobalHandshakeReturn {
  const [incoming,  setIncoming]  = useState<IncomingHandshake | null>(null);
  const [accepting, setAccepting] = useState(false);

  // Ref para el callback — evita reconstruir el canal si la función cambia
  const onAcceptedRef = useRef(onAccepted);
  useEffect(() => { onAcceptedRef.current = onAccepted; }, [onAccepted]);

  // ─── Canal Realtime ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return; // deshabilitado cuando está en el mapa

    const channel = supabase
      .channel(`global:hs:rx:${userId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'handshake_requests',
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
            setIncoming({
              requestId:     row.id,
              initiatorId:   row.initiator_id,
              initiatorName: row.initiator_name ?? 'Callejero',
            });
          }
        },
      )
      .subscribe();

    // Limpieza — evita memory leaks y consumo de batería
    return () => { supabase.removeChannel(channel); };
  }, [userId]); // se reconecta si userId cambia (login/logout)

  // ─── Handlers ──────────────────────────────────────────────────────────────
  const accept = async () => {
    if (!incoming || accepting) return;
    setAccepting(true);
    try {
      await respondToHandshake(incoming.requestId, 'accepted');
      setIncoming(null);
      onAcceptedRef.current(); // navegar al mapa
    } finally {
      setAccepting(false);
    }
  };

  const reject = async () => {
    if (!incoming) return;
    const { requestId } = incoming;
    setIncoming(null); // cierra modal inmediatamente (UX)

    await respondToHandshake(requestId, 'rejected');

    // XP base por haber tenido contacto, aunque no se complete la misión
    if (userId) {
      await supabase.from('actividades').insert({
        user_id:         userId,
        xp_ganado:       50,
        distancia:       0,
        mision_conjunta: false,
      });
    }
  };

  return { incoming, accepting, accept, reject };
}
