/**
 * TribeSelection — Onboarding obligatorio post-auth.
 * El usuario debe escribir su nombre/apodo Y elegir tribu para continuar.
 * Guarda ambos datos en la tabla `profiles` de Supabase.
 *
 * Schema requerido (profiles):
 *   id         uuid  PRIMARY KEY REFERENCES auth.users(id)
 *   name       text
 *   tribe      text  -- 'ciclista' | 'runner' | 'roller'
 *   updated_at timestamptz DEFAULT now()
 */
import { useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

type Tribe = 'ciclista' | 'runner' | 'roller';

const TRIBE_CONFIG: Record<Tribe, {
  label: string;
  icon: string;
  color: string;
  textColor: string;
  desc: string;
  flavor: string;
  multiplier: number;
}> = {
  ciclista: {
    label: 'Ciclista',
    icon: '🚲',
    color: '#0047AB',
    textColor: '#ffffff',
    desc: 'La ciudad es tu pista',
    flavor: 'Rodas la calle',
    multiplier: 1.0,
  },
  runner: {
    label: 'Runner',
    icon: '🏃',
    color: '#39FF14',
    textColor: '#000000',
    desc: 'Tus pies conocen cada barrio',
    flavor: 'Corres la calle',
    multiplier: 1.2,
  },
  roller: {
    label: 'Roller',
    icon: '🛼',
    color: '#FFD700',
    textColor: '#000000',
    desc: 'Deslizas la ciudad a tu ritmo',
    flavor: 'Ruedas la calle',
    multiplier: 1.5,
  },
};

interface TribeSelectionProps {
  authUser: User;
  onComplete: (tribe: string, name: string, multiplier: number) => void;
}

export default function TribeSelection({ authUser, onComplete }: TribeSelectionProps) {
  // Pre-llenar con nombre de Google si existe; vacío para Email/Password
  const googleName = authUser.user_metadata?.full_name ?? '';
  const [name,     setName]     = useState<string>(googleName);
  const [selected, setSelected] = useState<Tribe | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const trimmedName = name.trim();
  const canConfirm  = trimmedName.length > 0 && selected !== null;

  const handleConfirm = async () => {
    if (!canConfirm || loading) return;

    setLoading(true);
    setError(null);

    const cfg = TRIBE_CONFIG[selected!];
    const { error: upsertError } = await supabase.from('profiles').upsert({
      id:         authUser.id,
      name:       trimmedName,
      tribe:      selected,
      updated_at: new Date().toISOString(),
    });

    if (upsertError) {
      console.error('[TribeSelection]', upsertError.message);
      setError('No se pudo guardar tu perfil. Intenta de nuevo.');
      setLoading(false);
      return;
    }

    onComplete(cfg.label, trimmedName, cfg.multiplier);
  };

  const tribes = Object.entries(TRIBE_CONFIG) as [Tribe, typeof TRIBE_CONFIG[Tribe]][];

  return (
    <div className="h-screen w-full bg-black text-white flex flex-col justify-center items-center px-6 overflow-y-auto">

      {/* Header */}
      <div className="w-full max-w-sm pt-8 pb-2 text-center">
        <h2 className="text-4xl font-black italic uppercase tracking-tighter text-white leading-none">
          Crea tu Perfil
        </h2>
        <p className="text-white/40 text-sm font-medium tracking-tight mt-2">
          Define quién eres en la calle. Esta decisión es permanente.
        </p>
      </div>

      <div className="w-full max-w-sm mt-8 space-y-8">

        {/* ── Nombre / Apodo ── */}
        <div className="space-y-2">
          <label className="block text-[11px] font-black uppercase tracking-[0.25em] text-orange-500">
            Tu nombre o apodo
          </label>
          <input
            type="text"
            placeholder="¿Cómo te llaman en la calle?"
            maxLength={30}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading}
            className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white text-base font-bold placeholder:text-white/25 focus:outline-none focus:border-orange-500 transition-colors disabled:opacity-50"
          />
        </div>

        {/* ── Selección de tribu ── */}
        <div className="space-y-2">
          <label className="block text-[11px] font-black uppercase tracking-[0.25em] text-orange-500">
            Tu tribu
          </label>
          <div className="space-y-3">
            {tribes.map(([key, cfg]) => {
              const isSelected = selected === key;
              return (
                <button
                  key={key}
                  disabled={loading}
                  onClick={() => setSelected(key)}
                  className={`w-full px-5 py-4 rounded-2xl flex items-center gap-4 transition-all duration-200 active:scale-[0.98] border-2 outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                    isSelected ? 'scale-[1.01]' : 'scale-100 hover:scale-[1.005]'
                  }`}
                  style={{
                    backgroundColor: isSelected ? cfg.color : 'rgba(255,255,255,0.05)',
                    borderColor:     isSelected ? cfg.color : 'rgba(255,255,255,0.1)',
                    color:           isSelected ? cfg.textColor : '#ffffff',
                  }}
                >
                  <span className="text-3xl">{cfg.icon}</span>
                  <div className="text-left flex-1">
                    <p className="font-black text-base uppercase italic leading-none tracking-tight">
                      {cfg.label}
                    </p>
                    <p
                      className="text-xs font-semibold tracking-tight mt-0.5"
                      style={{ opacity: isSelected ? 0.7 : 0.4 }}
                    >
                      {cfg.desc}
                    </p>
                  </div>
                  {/* Check indicator */}
                  <div
                    className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
                    style={{
                      borderColor:     isSelected ? cfg.textColor : 'rgba(255,255,255,0.2)',
                      backgroundColor: isSelected ? cfg.textColor : 'transparent',
                    }}
                  >
                    {isSelected && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path
                          d="M1 4L3.5 6.5L9 1"
                          stroke={cfg.color}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Confirmar ── */}
        <button
          onClick={handleConfirm}
          disabled={!canConfirm || loading}
          className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-[0.15em] transition-all duration-200 active:scale-[0.98]"
          style={{
            backgroundColor: canConfirm ? '#FF5F1F' : 'rgba(255,255,255,0.07)',
            color:           canConfirm ? '#000000' : 'rgba(255,255,255,0.25)',
            cursor:          canConfirm ? 'pointer'  : 'not-allowed',
          }}
        >
          {loading ? 'Guardando...' : 'Entrar a la Calle'}
        </button>

        {error && (
          <p className="text-red-400 text-sm font-bold text-center">{error}</p>
        )}
      </div>

      <p className="mt-8 mb-8 text-white/20 text-xs text-center font-medium tracking-wide max-w-xs">
        Ciclistas ruedan. Runners corren. Rollers deslizan.
        Todos tienen Calle.
      </p>
    </div>
  );
}
