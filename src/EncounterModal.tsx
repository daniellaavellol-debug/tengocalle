/**
 * EncounterModal.tsx — Modal de Encuentro Callejero para el iniciador (Usuario A).
 *
 * Flujo:
 *   idle     → A ve su código + ingresa el de B
 *   waiting  → Encuentro creado (status=pending), esperando respuesta de B
 *   accepted → B aceptó → +100 XP total
 *   finished → B rechazó/expiró → +50 XP base
 */

import { useState, useEffect, useRef } from 'react';
import { supabase } from './lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  ensureHandshakeCode,
  lookupReceiverByCode,
  confirmEncuentro,
  subscribeToEncuentroUpdates,
} from './services/handshakeService';

interface Props {
  onSuccess:    () => void;              // registra el encuentro en App.tsx (+50 local)
  onClose:      () => void;
  isFirstEncounter: boolean;
  onXpBonus?:   (amount: number) => void; // llamado si B acepta (+50 extra)
}

type Phase = 'idle' | 'waiting' | 'accepted' | 'finished';

export default function EncounterModal({
  onSuccess, onClose, onXpBonus,
}: Props) {
  const [myCode,        setMyCode]        = useState('');
  const [userId,        setUserId]        = useState<string | null>(null);
  const [inputCode,     setInputCode]     = useState('');
  const [phase,         setPhase]         = useState<Phase>('idle');
  const [submitting,    setSubmitting]    = useState(false);
  const [error,         setError]         = useState('');
  const [receiverName,  setReceiverName]  = useState('');
  // 'loading' → DB no confirmó aún | 'ready' → código guardado y visible | 'error' → falló
  const [codeState,     setCodeState]     = useState<'loading' | 'ready' | 'error'>('loading');

  const channelRef = useRef<RealtimeChannel | null>(null);

  // ── Publicar código propio (solo lo muestra DESPUÉS de confirmar escritura en DB) ──
  const publishCode = async (uid: string) => {
    setCodeState('loading');
    const confirmed = await ensureHandshakeCode(uid);
    if (!confirmed) {
      setCodeState('error');
    } else {
      setMyCode(confirmed);   // código viene de DB — garantiza sincronía UI↔Supabase
      setCodeState('ready');
    }
  };

  // ── Montar: obtener sesión y publicar código ──────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setCodeState('error'); return; }
      setUserId(user.id);
      void publishCode(user.id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Desmontar: limpiar canal de updates ──────────────────────────────────────
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  // ── Confirmar encuentro ───────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!/^\d{4}$/.test(inputCode)) { setError('Ingresa exactamente 4 dígitos'); return; }
    if (!userId) { setError('Sin sesión activa. Recarga la app.'); return; }

    setSubmitting(true);
    setError('');

    // 1. Buscar receptor por código (trae nombre para el UI de espera)
    const receiver = await lookupReceiverByCode(inputCode);
    if (!receiver) {
      setError('Código no encontrado. Pídele a tu compañero que abra la app.');
      setSubmitting(false);
      return;
    }

    // 2. Confirmar encuentro — status=pending, XP base +50 para ambos
    const result = await confirmEncuentro(receiver.id, inputCode);
    if (!result.success) {
      setError(result.error ?? 'Error al confirmar el encuentro.');
      setSubmitting(false);
      return;
    }

    // 3. Notificar a App.tsx para actualizar encuentros y XP base local
    onSuccess();
    setReceiverName(receiver.name || 'Callejero');
    setPhase('waiting');
    setSubmitting(false);

    // 4. Suscribirse a la respuesta de B
    if (result.encuentroId) {
      channelRef.current = subscribeToEncuentroUpdates(
        result.encuentroId,
        (enc) => {
          if (enc.status === 'accepted') {
            onXpBonus?.(50);          // +50 XP bonus local para A
            setPhase('accepted');
          } else if (enc.status === 'rejected' || enc.status === 'expired') {
            setPhase('finished');
          }
        },
      );
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm bg-white rounded-t-[2.5rem] p-8 pb-12 shadow-2xl">

        {/* ── FASE idle: mostrar código propio + input ── */}
        {phase === 'idle' && (
          <>
            <div className="flex justify-between items-start mb-6">
              <div>
                <p className="text-black/40 font-black text-[10px] uppercase tracking-[0.2em]">
                  Encuentro Callejero
                </p>
                <h2 className="text-2xl font-black italic uppercase tracking-tight leading-tight">
                  Tu Código
                </h2>
              </div>
              <button
                onClick={onClose}
                className="text-black/30 font-black text-xl leading-none p-1"
              >✕</button>
            </div>

            <div className="bg-black rounded-2xl p-6 mb-6 text-center">
              <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-2">
                Muéstrale este código
              </p>

              {codeState === 'ready' && (
                <p className="text-5xl font-black italic tracking-[0.2em] text-orange-500">
                  {myCode}
                </p>
              )}

              {codeState === 'loading' && (
                <p className="text-white/20 text-sm font-black uppercase tracking-widest animate-pulse">
                  Generando código…
                </p>
              )}

              {codeState === 'error' && (
                <>
                  <p className="text-red-400 text-xs font-bold mb-3 leading-tight">
                    No se pudo guardar el código.{'\n'}Tu compañero no podrá encontrarte.
                  </p>
                  <button
                    onClick={() => userId && void publishCode(userId)}
                    className="bg-orange-500 text-black text-xs font-black uppercase tracking-widest px-4 py-2 rounded-full"
                  >
                    Reintentar
                  </button>
                </>
              )}
            </div>

            <div className="mb-2">
              <p className="text-black/50 text-[11px] font-black uppercase tracking-widest mb-3">
                Ingresa el código de tu compañero
              </p>
              <input
                type="number"
                inputMode="numeric"
                maxLength={4}
                placeholder="1234"
                value={inputCode}
                onChange={(e) => { setInputCode(e.target.value.slice(0, 4)); setError(''); }}
                className="w-full text-center text-3xl font-black tracking-[0.3em] p-4 rounded-2xl border-2 border-black/10 focus:border-orange-500 outline-none bg-black/5 text-black"
              />
              {error && (
                <p className="text-red-500 text-xs font-bold mt-2 text-center">{error}</p>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full mt-4 bg-orange-500 text-black font-black py-5 rounded-full text-lg italic uppercase tracking-widest active:scale-95 transition-all border-none outline-none shadow-lg shadow-orange-500/30 disabled:opacity-60"
            >
              {submitting ? 'Verificando...' : 'CONFIRMAR ENCUENTRO'}
            </button>
          </>
        )}

        {/* ── FASE waiting: esperando respuesta de B ── */}
        {phase === 'waiting' && (
          <div className="text-center py-4">
            <div className="text-5xl mb-4 animate-pulse">⏳</div>
            <p className="text-orange-500 font-black text-[11px] uppercase tracking-[0.3em] mb-2">
              Encuentro enviado
            </p>
            <h2 className="text-2xl font-black italic uppercase tracking-tight mb-2">
              Esperando a {receiverName}
            </h2>
            <p className="text-black/50 text-sm font-bold mb-6">
              +50 XP base garantizados
            </p>
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4 mb-6">
              <p className="text-orange-500 font-black text-base italic">+50 XP ✓</p>
              <p className="text-black/40 text-xs font-bold mt-1">
                Si {receiverName} acepta → +100 XP total 🔥
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full bg-black/10 text-black/50 font-black py-4 rounded-full text-sm italic uppercase tracking-widest border-none outline-none"
            >
              Cerrar (seguirás recibiendo la respuesta)
            </button>
          </div>
        )}

        {/* ── FASE accepted: B aceptó ── */}
        {phase === 'accepted' && (
          <div className="text-center py-4">
            <div className="text-6xl mb-4">🔥</div>
            <p className="text-orange-500 font-black text-[11px] uppercase tracking-[0.3em] mb-2">
              ¡Misión Conjunta!
            </p>
            <h2 className="text-2xl font-black italic uppercase tracking-tight mb-1">
              {receiverName} aceptó
            </h2>
            <p className="text-black/50 text-sm font-bold mb-6">
              ¡El bono se duplicó para ambos!
            </p>
            <div className="bg-orange-500 rounded-2xl p-5 mb-6 text-black">
              <p className="font-black text-4xl italic">+100 XP total 🎉</p>
              <p className="text-xs font-black uppercase tracking-widest opacity-70 mt-1">
                +50 base · +50 misión conjunta
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full bg-black text-white font-black py-5 rounded-full text-base italic uppercase tracking-widest active:scale-95 transition-all border-none outline-none"
            >
              CERRAR
            </button>
          </div>
        )}

        {/* ── FASE finished: B rechazó o expiró ── */}
        {phase === 'finished' && (
          <div className="text-center py-4">
            <div className="text-5xl mb-4">🤝</div>
            <p className="text-orange-500 font-black text-[11px] uppercase tracking-[0.3em] mb-2">
              Encuentro Registrado
            </p>
            <h2 className="text-2xl font-black italic uppercase tracking-tight mb-1">
              ¡Callejero encontrado!
            </h2>
            <p className="text-black/50 text-sm font-bold mb-6">
              {receiverName} no aceptó la misión conjunta
            </p>
            <div className="bg-black/5 rounded-2xl p-5 mb-6">
              <p className="font-black text-3xl italic text-orange-500">+50 XP</p>
              <p className="text-xs text-black/40 font-bold uppercase tracking-widest mt-1">
                XP base del encuentro
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full bg-black text-white font-black py-5 rounded-full text-base italic uppercase tracking-widest active:scale-95 transition-all border-none outline-none"
            >
              CERRAR
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
