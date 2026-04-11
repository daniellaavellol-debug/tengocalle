/**
 * EncuentroPopup.tsx — Pop-up global de misión conjunta para el receptor (Usuario B).
 *
 * Montado en App.tsx, siempre activo cuando hay sesión.
 * Se suscribe a INSERTs en `encuentros` WHERE user_b_id = userId.
 * Permite aceptar (+50 XP extra) o rechazar (se queda el XP base).
 * Se auto-expira a los 30 segundos.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  subscribeToEncuentros,
  unsubscribeFromEncuentros,
  acceptEncuentro,
  rejectEncuentro,
} from '../services/handshakeService';

interface IncomingEncuentro {
  id:         string;
  userAId:    string;
  userAName:  string;
  userATribe: string;
}

interface Props {
  userId:      string | null;
  onXpGained?: (amount: number) => void;  // llamado cuando B acepta (+50 bonus)
}

const COUNTDOWN_SEC = 30;

export default function EncuentroPopup({ userId, onXpGained }: Props) {
  const [incoming,  setIncoming]  = useState<IncomingEncuentro | null>(null);
  const [countdown, setCountdown] = useState(COUNTDOWN_SEC);
  const [phase,     setPhase]     = useState<'prompt' | 'accepted' | 'done'>('prompt');
  const [busy,      setBusy]      = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Limpiar timer ────────────────────────────────────────────────────────────
  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // ── Iniciar countdown ────────────────────────────────────────────────────────
  const startCountdown = useCallback((id: string) => {
    clearTimer();
    let remaining = COUNTDOWN_SEC;
    timerRef.current = setInterval(async () => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        clearTimer();
        console.log('[CALLE:Handshake] ⏰ Timeout — rechazando encuentro:', id);
        await rejectEncuentro(id, 'expired');
        setIncoming(null);
        setPhase('prompt');
      }
    }, 1000);
  }, [clearTimer]);

  // ── Suscripción Realtime (se monta una vez por userId) ───────────────────────
  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    subscribeToEncuentros(async (encuentro) => {
      if (cancelled) return;
      console.log('[CALLE:Handshake] 🔔 EncuentroPopup — nuevo encuentro recibido:', encuentro);

      // Obtener nombre y tribu del iniciador (A)
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, tribe')
        .eq('id', encuentro.user_a_id)
        .maybeSingle();

      if (cancelled) return;

      setIncoming({
        id:         encuentro.id ?? '',
        userAId:    encuentro.user_a_id as string,
        userAName:  (profile?.name  as string) ?? 'Callejero',
        userATribe: (profile?.tribe as string) ?? '',
      });
      setCountdown(COUNTDOWN_SEC);
      setPhase('prompt');

      // Vibración táctil
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

      startCountdown(encuentro.id ?? '');
    });

    return () => {
      cancelled = true;
      clearTimer();
      void unsubscribeFromEncuentros();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleAccept = async () => {
    if (!incoming || busy) return;
    setBusy(true);
    clearTimer();
    console.log('[CALLE:Handshake] B acepta encuentro:', incoming.id);

    const result = await acceptEncuentro(incoming.id);
    if (result.success) {
      onXpGained?.(50);   // +50 XP bonus para B en local state
      setPhase('accepted');
      setTimeout(() => {
        setIncoming(null);
        setPhase('prompt');
        setBusy(false);
      }, 2200);
    } else {
      console.error('[CALLE:Handshake] Error aceptando:', result.error);
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!incoming || busy) return;
    setBusy(true);
    clearTimer();
    await rejectEncuentro(incoming.id, 'rejected');
    setIncoming(null);
    setPhase('prompt');
    setBusy(false);
  };

  if (!incoming) return null;

  const progressPct = (countdown / COUNTDOWN_SEC) * 100;

  return (
    <>
      {/* Keyframes inline — sin dependencias nuevas */}
      <style>{`
        @keyframes ep-enter {
          from { opacity: 0; transform: scale(0.82) translateY(24px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
        @keyframes ep-bounce {
          0%,100% { transform: scale(1); }
          40%     { transform: scale(1.28); }
          70%     { transform: scale(0.95); }
        }
        @keyframes ep-progress {
          from { width: 100%; }
          to   { width: 0%;   }
        }
        .ep-bounce { animation: ep-bounce 0.65s ease-in-out; }
      `}</style>

      {/* Overlay */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: 'rgba(10,10,10,0.95)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '1.5rem',
        }}
      >
        {/* Card */}
        <div
          style={{
            width: '100%', maxWidth: '22rem',
            background: '#111', borderRadius: '2rem',
            padding: '2rem 1.75rem',
            border: `1.5px solid rgba(255,255,255,0.08)`,
            boxShadow: `0 0 48px rgba(255,95,31,0.18)`,
            animation: 'ep-enter 0.3s cubic-bezier(0.34,1.56,0.64,1) both',
            textAlign: 'center',
          }}
        >
          {phase === 'prompt' ? (
            <>
              {/* Emoji */}
              <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>🤝</div>

              {/* Título */}
              <p style={{
                color: '#FF5F1F', fontWeight: 900, fontSize: '0.65rem',
                letterSpacing: '0.25em', textTransform: 'uppercase', marginBottom: '0.4rem',
              }}>
                ¡Te encontraron!
              </p>
              <h2 style={{
                color: '#fff', fontWeight: 900, fontSize: '1.4rem',
                fontStyle: 'italic', textTransform: 'uppercase',
                letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '0.5rem',
              }}>
                {incoming.userAName}
              </h2>
              <p style={{
                color: 'rgba(255,255,255,0.45)', fontWeight: 600, fontSize: '0.8rem',
                marginBottom: '1.25rem',
              }}>
                te propone una misión conjunta
              </p>

              {/* XP base confirmado */}
              <div style={{
                background: 'rgba(255,255,255,0.05)', borderRadius: '0.75rem',
                padding: '0.6rem 1rem', marginBottom: '1.25rem', display: 'inline-block',
              }}>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 700, fontSize: '0.7rem' }}>
                  +50 XP base{' '}
                  <span style={{ color: '#22C55E', fontWeight: 900 }}>✓ garantizado</span>
                </span>
              </div>

              {/* Botón ACEPTAR */}
              <button
                onClick={handleAccept}
                disabled={busy}
                style={{
                  width: '100%', padding: '1rem', borderRadius: '1rem', border: 'none',
                  background: '#FF5F1F', color: '#000',
                  fontWeight: 900, fontSize: '0.95rem', fontStyle: 'italic',
                  letterSpacing: '0.05em', textTransform: 'uppercase',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                  boxShadow: '0 4px 24px rgba(255,95,31,0.45)',
                  marginBottom: '0.6rem',
                }}
              >
                {busy ? 'Procesando...' : 'ACEPTAR MISIÓN 🔥'}
                <br />
                <span style={{ fontWeight: 700, fontSize: '0.7rem', opacity: 0.85, fontStyle: 'normal' }}>
                  +50 XP extra (total 100 XP)
                </span>
              </button>

              {/* Botón RECHAZAR */}
              <button
                onClick={handleReject}
                disabled={busy}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '1rem', border: 'none',
                  background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)',
                  fontWeight: 700, fontSize: '0.8rem', letterSpacing: '0.05em',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  marginBottom: '1rem',
                }}
              >
                No, gracias
              </button>

              {/* Countdown */}
              <p style={{
                color: 'rgba(255,255,255,0.3)', fontSize: '0.65rem',
                fontWeight: 700, letterSpacing: '0.1em', marginBottom: '0.5rem',
              }}>
                EXPIRA EN {countdown}s
              </p>
              {/* Barra de progreso */}
              <div style={{
                width: '100%', height: '3px', background: 'rgba(255,255,255,0.08)',
                borderRadius: '99px', overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', background: '#FF5F1F', borderRadius: '99px',
                  width: `${progressPct}%`,
                  transition: 'width 1s linear',
                }} />
              </div>
            </>
          ) : (
            /* Fase aceptada */
            <>
              <div style={{ fontSize: '3.5rem', marginBottom: '0.75rem' }}>🎉</div>
              <p style={{
                color: '#FF5F1F', fontWeight: 900, fontSize: '0.65rem',
                letterSpacing: '0.25em', textTransform: 'uppercase', marginBottom: '0.5rem',
              }}>
                ¡Misión Conjunta!
              </p>
              <p
                className="ep-bounce"
                style={{
                  color: '#FF5F1F', fontWeight: 900, fontSize: '2.5rem',
                  fontStyle: 'italic', marginBottom: '0.25rem',
                  display: 'inline-block',
                }}
              >
                +100 XP
              </p>
              <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem', fontWeight: 600 }}>
                ¡Ambos ganan el bono completo!
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
