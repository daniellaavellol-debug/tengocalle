import { CLASS_XP_FACTORS, TIME_XP_PER_MIN } from './utils/xpLogic';

interface Props {
  xp: number;
  distanceKm: number;
  durationSec: number;
  multiplier: number;   // round multiplier (1, 2, 4, 8) — de perfil
  userClass: string;    // 'Runner' | 'Roller' | 'Ciclista'
  missionBonusXp: number; // bonus raw de misiones (antes de ×mult)
  onHome: () => void;
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function Summary({
  xp, distanceKm, durationSec, multiplier, userClass, missionBonusXp, onHome,
}: Props) {
  // ── Componentes pre-multiplicador ────────────────────────────────────────
  const factor     = CLASS_XP_FACTORS[userClass] ?? CLASS_XP_FACTORS.Roller;
  const minutes    = durationSec / 60;
  const kmXpRaw    = distanceKm * factor;
  const minXpRaw   = minutes * TIME_XP_PER_MIN;
  const hasMission = missionBonusXp > 0;

  // xp es el ground truth calculado por calcTotalXp:
  //   round((km×factor + min + missionBonus + encounterBonus) × mult)
  // Lo mostramos siempre como autoridad al final.

  return (
    <div className="h-full w-full bg-black text-white p-6 flex flex-col overflow-y-auto pb-10">

      {/* Header */}
      <div className="text-center mb-6 pt-8">
        <p className="text-orange-500 font-black text-[11px] uppercase tracking-[0.3em] mb-2">
          Sesión Finalizada
        </p>
        <h1 className="text-4xl font-black italic uppercase tracking-tighter leading-none">
          ¡CALLE<br />COMPLETADA!
        </h1>
      </div>

      {/* Stats de sesión */}
      <div className="bg-white rounded-[2.5rem] p-6 mb-4 shadow-xl text-black">
        <h3 className="font-black text-black/40 uppercase text-[10px] tracking-[0.2em] mb-4">Tu Salida</h3>
        <div className="grid grid-cols-2 gap-4 text-center">
          <div className="bg-black/5 p-5 rounded-3xl">
            <p className="text-[10px] text-black/50 font-black uppercase tracking-widest mb-1">Distancia</p>
            <p className="text-3xl font-black text-orange-500 italic tracking-tighter">{distanceKm.toFixed(2)}</p>
            <p className="text-[10px] font-black text-black/40 uppercase">km</p>
          </div>
          <div className="bg-black/5 p-5 rounded-3xl">
            <p className="text-[10px] text-black/50 font-black uppercase tracking-widest mb-1">Tiempo</p>
            <p className="text-3xl font-black text-orange-500 italic tracking-tighter">
              {Math.floor(durationSec / 60).toString().padStart(2, '0')}
              :{(durationSec % 60).toString().padStart(2, '0')}
            </p>
            <p className="text-[10px] font-black text-black/40 uppercase">min:seg</p>
          </div>
        </div>
      </div>

      {/* Desglose XP — espejo exacto de calcTotalXp */}
      <div className="bg-white rounded-[2.5rem] p-6 mb-4 shadow-xl text-black">
        <h3 className="font-black text-black/40 uppercase text-[10px] tracking-[0.2em] mb-4">Cálculo de XP</h3>
        <div className="space-y-3">

          {/* Componentes pre-multiplicador */}
          <XpRow
            label={`${distanceKm.toFixed(2)} km × ${factor} XP/km`}
            value={`+${Math.round(kmXpRaw)} XP`}
          />
          <XpRow
            label={`${formatTime(durationSec)} × ${TIME_XP_PER_MIN} XP/min`}
            value={`+${Math.round(minXpRaw)} XP`}
          />

          {/* Bonus de misiones — componente separado, pre-multiplicador */}
          {hasMission && (
            <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-2xl px-3 py-2">
              <span className="text-[12px] text-orange-700 font-bold italic">🎯 Bonus Misiones</span>
              <span className="font-black text-sm text-orange-600">+{missionBonusXp} XP</span>
            </div>
          )}

          {/* Separador: multiplicador de vuelta */}
          <div className="border-t border-black/10 pt-3 flex justify-between items-center">
            <span className="text-[12px] text-black/50 font-bold italic uppercase tracking-tight">
              Vuelta {userClass} (×{multiplier})
            </span>
            <span className="font-black text-sm text-black">×{multiplier}</span>
          </div>

          {/* Total autoritativo = lo que calcTotalXp devolvió */}
          <div className="border-t-2 border-orange-500 pt-3 flex justify-between items-center">
            <span className="font-black uppercase text-sm italic tracking-tight">TOTAL</span>
            <span className="font-black text-orange-500 text-3xl italic">{xp} XP</span>
          </div>

        </div>
      </div>

      <button
        onClick={onHome}
        className="w-full bg-orange-500 text-black font-black py-6 rounded-full shadow-2xl shadow-orange-500/50 text-xl italic uppercase tracking-widest active:scale-95 transition-all border-none outline-none"
      >
        VOLVER AL HOME
      </button>
    </div>
  );
}

function XpRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[12px] text-black/60 font-bold italic">{label}</span>
      <span className="font-black text-sm text-black">{value}</span>
    </div>
  );
}
