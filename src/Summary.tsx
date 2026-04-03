interface NewlyCompleted {
  salALaCalle: boolean;
  aveNocturna: boolean;
}

interface Props {
  xp: number;
  distanceKm: number;
  durationSec: number;
  multiplier: number;
  userClass: string;
  newlyCompleted: NewlyCompleted;
  missionBonusXp: number;
  onHome: () => void;
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} min ${s} seg` : `${s} seg`;
}

export default function Summary({
  xp, distanceKm, durationSec, multiplier, userClass, newlyCompleted, missionBonusXp, onHome,
}: Props) {
  const baseKmXp = Math.round(10 * distanceKm);
  const baseMinXp = Math.round(2 * (durationSec / 60));
  const staticBonus = (newlyCompleted.salALaCalle ? 50 : 0) + (newlyCompleted.aveNocturna ? 100 : 0);
  const missionBonus = staticBonus + missionBonusXp;
  const totalWithBonus = xp + missionBonus;
  const hasBonus = missionBonus > 0;

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

      {/* Desglose XP */}
      <div className="bg-white rounded-[2.5rem] p-6 mb-4 shadow-xl text-black">
        <h3 className="font-black text-black/40 uppercase text-[10px] tracking-[0.2em] mb-4">Cálculo de XP</h3>
        <div className="space-y-3">
          <XpRow label={`${distanceKm.toFixed(2)} km × 10 XP`} value={`+${baseKmXp} XP`} />
          <XpRow label={`${formatTime(durationSec)} × 2 XP/min`} value={`+${baseMinXp} XP`} />
          <XpRow label={`Clase ${userClass} (×${multiplier})`} value={`×${multiplier}`} />

          <div className="border-t border-black/10 pt-3 flex justify-between items-center">
            <span className="font-black uppercase text-sm italic tracking-tight">XP de Salida</span>
            <span className="font-black text-orange-500 text-2xl italic">{xp} XP</span>
          </div>

          {newlyCompleted.salALaCalle && (
            <MissionBonus icon="🚲" label="Misión: Sal a la Calle" bonus={50} />
          )}
          {newlyCompleted.aveNocturna && (
            <MissionBonus icon="🌙" label="Misión: Ave Nocturna" bonus={100} />
          )}

          {hasBonus && (
            <div className="border-t-2 border-orange-500 pt-3 flex justify-between items-center">
              <span className="font-black uppercase text-sm italic tracking-tight">TOTAL</span>
              <span className="font-black text-orange-500 text-3xl italic">{totalWithBonus} XP</span>
            </div>
          )}
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

function MissionBonus({ icon, label, bonus }: { icon: string; label: string; bonus: number }) {
  return (
    <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-2xl p-3">
      <div className="flex items-center gap-2">
        <span>{icon}</span>
        <div>
          <p className="text-[10px] font-black text-green-700 uppercase tracking-wider">¡Misión Completada!</p>
          <p className="text-xs font-bold text-black/70 italic">{label}</p>
        </div>
      </div>
      <span className="font-black text-green-600 italic">+{bonus} XP</span>
    </div>
  );
}
