import { useState } from 'react';

interface Props {
  onSuccess: () => void;
  onClose: () => void;
  isFirstEncounter: boolean;
}

export default function EncounterModal({ onSuccess, onClose, isFirstEncounter }: Props) {
  const [myCode] = useState(() => Math.floor(1000 + Math.random() * 9000).toString());
  const [inputCode, setInputCode] = useState('');
  const [phase, setPhase] = useState<'idle' | 'success'>('idle');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (inputCode.length !== 4 || !/^\d{4}$/.test(inputCode)) {
      setError('Ingresa exactamente 4 dígitos');
      return;
    }
    setError('');
    setPhase('success');
    onSuccess();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm bg-white rounded-t-[2.5rem] p-8 pb-12 shadow-2xl">

        {phase === 'idle' ? (
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
              >
                ✕
              </button>
            </div>

            {/* Mi código */}
            <div className="bg-black rounded-2xl p-6 mb-6 text-center">
              <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-2">
                Muéstrale este código
              </p>
              <p className="text-5xl font-black italic tracking-[0.2em] text-orange-500">
                {myCode}
              </p>
            </div>

            {/* Input del código del otro */}
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
                onChange={(e) => {
                  const val = e.target.value.slice(0, 4);
                  setInputCode(val);
                  setError('');
                }}
                className="w-full text-center text-3xl font-black tracking-[0.3em] p-4 rounded-2xl border-2 border-black/10 focus:border-orange-500 outline-none bg-black/5 text-black"
              />
              {error && (
                <p className="text-red-500 text-xs font-bold mt-2 text-center">{error}</p>
              )}
            </div>

            <button
              onClick={handleSubmit}
              className="w-full mt-4 bg-orange-500 text-black font-black py-5 rounded-full text-lg italic uppercase tracking-widest active:scale-95 transition-all border-none outline-none shadow-lg shadow-orange-500/30"
            >
              CONFIRMAR ENCUENTRO
            </button>
          </>
        ) : (
          /* Estado de éxito */
          <div className="text-center py-4">
            <div className="text-6xl mb-4">🤝</div>
            <p className="text-orange-500 font-black text-[11px] uppercase tracking-[0.3em] mb-2">
              ¡Encuentro Exitoso!
            </p>
            <h2 className="text-2xl font-black italic uppercase tracking-tight mb-1">
              ¡Nuevo Callejero!
            </h2>
            <p className="text-black/50 text-sm font-bold mb-6">
              {isFirstEncounter
                ? 'Primer encuentro — misión desbloqueada'
                : 'Callejero registrado en tu red'}
            </p>

            <div className="bg-orange-500 rounded-2xl p-5 mb-6 text-black">
              <p className="font-black text-4xl italic">
                +{isFirstEncounter ? '200' : '50'} XP
              </p>
              {isFirstEncounter && (
                <p className="text-xs font-black uppercase tracking-widest opacity-70 mt-1">
                  +50 base · +150 misión Sociable
                </p>
              )}
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
