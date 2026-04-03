import { useEffect, useState } from 'react';
import { fetchMissions, type Mission } from './lib/missions';

interface Props {
  userLevel: number;
  userClass: string;
  completedIds: number[];
}

export default function MisionesList({ userLevel, userClass, completedIds }: Props) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMissions().then(data => {
      // Mostrar: categoría 'Todas' + categoría del usuario; ocultar otras clases
      const visible = data.filter(
        m => m.category === 'Todas' || m.category === userClass
      );
      setMissions(visible);
      setLoading(false);
    });
  }, [userClass]);

  if (loading) {
    return (
      <div className="bg-white p-5 rounded-[2.5rem] shadow-xl shadow-black/20 text-center">
        <p className="text-black/30 text-xs font-black uppercase tracking-widest animate-pulse">
          Cargando misiones...
        </p>
      </div>
    );
  }

  if (missions.length === 0) return null;

  return (
    <div className="bg-white p-5 rounded-[2.5rem] shadow-xl shadow-black/20">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-black text-black/40 uppercase text-[10px] tracking-[0.2em]">
          Desafíos · {missions.length}
        </h3>
        <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest">
          LVL {userLevel}
        </span>
      </div>
      <div className="space-y-3">
        {missions.map((m, i) => {
          const done    = completedIds.includes(m.id);
          const locked  = m.min_level > userLevel;
          const isLast  = i === missions.length - 1;
          return (
            <MissionCard
              key={m.id}
              mission={m}
              done={done}
              locked={locked}
              last={isLast}
            />
          );
        })}
      </div>
    </div>
  );
}

function MissionCard({
  mission: m, done, locked, last,
}: {
  mission: Mission; done: boolean; locked: boolean; last: boolean;
}) {
  const dimmed = done || locked;
  return (
    <div className={`flex items-center gap-3 transition-opacity ${!last ? 'border-b border-black/5 pb-3' : ''} ${dimmed ? 'opacity-40' : ''}`}>
      {/* Icono */}
      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-xl flex-shrink-0 shadow-inner
        ${done ? 'bg-green-100' : locked ? 'bg-black/5' : 'bg-orange-100'}`}>
        {done ? '✅' : locked ? '🔒' : (m.icon ?? '⭐')}
      </div>

      {/* Texto */}
      <div className="flex-1 min-w-0">
        <p className="font-black text-sm italic uppercase leading-none tracking-tight truncate">
          {m.title}
        </p>
        <p className="text-[10px] text-black/50 font-bold italic uppercase tracking-tight mt-0.5">
          {locked
            ? `Desbloquea en LVL ${m.min_level}`
            : done
            ? 'COMPLETADA'
            : m.description}
        </p>
      </div>

      {/* XP / Estado */}
      <div className={`font-black text-sm italic flex-shrink-0
        ${done ? 'text-green-500' : locked ? 'text-black/20' : 'text-orange-500'}`}>
        {done ? '✓' : `+${m.xp_reward} XP`}
      </div>
    </div>
  );
}
