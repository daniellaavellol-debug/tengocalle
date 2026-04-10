import type { UserData } from './App';
import { calculateLevel, xpForNextLevel } from './lib/xp';

interface Props {
  user: UserData;
}

export default function Stats({ user }: Props) {
  const level = calculateLevel(user.totalXp);
  const { current: xpCurrent, needed: nextLevelXp, progress } = xpForNextLevel(user.totalXp);

  return (
    <div className="h-full w-full bg-black text-white p-4 flex flex-col overflow-y-auto pb-20">

      {/* Header */}
      <div className="text-center pt-8 pb-6">
        <p className="text-orange-500 font-black text-[11px] uppercase tracking-[0.3em] mb-1">
          ¿Cuánta Calle tienes?
        </p>
        <h1 className="text-4xl font-black italic uppercase tracking-tighter leading-none">
          Tu Calle
        </h1>
      </div>

      {/* Tarjeta de perfil */}
      <div className="bg-white text-black rounded-[2.5rem] p-6 mb-4 shadow-xl shadow-black/20">
        <div className="flex justify-between items-start mb-4">
          <div>
            <p className="text-black/40 text-xs font-black uppercase tracking-widest">Callejero</p>
            <h2 className="text-3xl font-black italic tracking-tighter leading-none">{user.name}</h2>
            <p className="text-orange-500 font-black text-xs uppercase tracking-[0.2em] mt-1">{user.userClass}</p>
          </div>
          <div className="bg-orange-500 text-black px-4 py-2 rounded-full font-black text-lg italic uppercase tracking-tighter shadow-lg shadow-orange-500/30">
            LVL {level}
          </div>
        </div>

        {/* Barra de progreso XP */}
        <div className="mb-1">
          <div className="flex justify-between mb-1">
            <span className="text-[10px] font-black text-black/40 uppercase tracking-widest">XP</span>
            <span className="text-[10px] font-black text-black/40 uppercase tracking-widest">
              {xpCurrent} / {nextLevelXp}
            </span>
          </div>
          <div className="w-full h-2.5 bg-black/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-500 rounded-full transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <p className="text-[10px] text-black/30 font-bold italic text-right">
          Próximo nivel: {nextLevelXp - xpCurrent} XP
        </p>
      </div>

      {/* Stats en cuadrícula */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatCard
          icon="⭐"
          label="XP Total"
          value={user.totalXp.toLocaleString()}
          unit="puntos"
        />
        <StatCard
          icon="📍"
          label="KM Totales"
          value={user.totalKm.toFixed(1)}
          unit="kilómetros"
        />
        <StatCard
          icon="🔥"
          label="Racha Actual"
          value={user.streak.toString()}
          unit="días"
        />
        <StatCard
          icon="🤝"
          label="Callejeros"
          value={user.encounters.toString()}
          unit="conocidos"
        />
      </div>

    </div>
  );
}

function StatCard({ icon, label, value, unit }: {
  icon: string; label: string; value: string; unit: string;
}) {
  return (
    <div className="bg-white text-black rounded-3xl p-5 shadow-xl shadow-black/20 text-center">
      <span className="text-2xl">{icon}</span>
      <p className="text-[10px] text-black/40 font-black uppercase tracking-widest mt-1">{label}</p>
      <p className="text-3xl font-black text-orange-500 italic tracking-tighter">{value}</p>
      <p className="text-[10px] font-black text-black/30 uppercase">{unit}</p>
    </div>
  );
}

