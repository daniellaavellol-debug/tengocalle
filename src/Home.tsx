import { useState } from 'react';
import EncounterModal from './EncounterModal';
import MisionesPanel from './components/MisionesPanel';
import type { Missions } from './App';

interface Props {
  userName: string;
  userClass: string;
  totalXp: number;
  userLevel: number;
  missions: Missions;
  completedMissionIds: number[];
  onStart: () => void;
  onEncounter: () => void;
}

export default function Home({ userName, userClass, totalXp, userLevel, missions, completedMissionIds, onStart, onEncounter }: Props) {
  const [showEncounter, setShowEncounter] = useState(false);
  const [showMisiones, setShowMisiones] = useState(false);

  return (
    <div className="h-full w-full bg-black text-black flex flex-col overflow-hidden">

      {/* Área scrollable */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-32">

        {/* Header compacto — nombre + nivel en una sola fila */}
        <div className="bg-white px-5 py-4 rounded-[2rem] mb-3 flex justify-between items-center shadow-xl shadow-black/20">
          <div>
            <p className="text-black/40 text-[10px] font-black uppercase tracking-[0.2em] leading-none mb-1">¿Cuánta Calle tienes?</p>
            <h2 className="text-2xl font-black italic tracking-tighter leading-none">{userName}</h2>
            <p className="text-orange-500 font-black text-[10px] uppercase tracking-[0.2em] mt-1">{userClass}</p>
          </div>
          <div className="bg-orange-500 text-black px-4 py-2 rounded-full font-black text-[11px] italic uppercase tracking-tighter shadow-lg shadow-orange-500/30 flex-shrink-0">
            LVL {userLevel}
          </div>
        </div>

        {/* Stats — compactos */}
        <div className="bg-white px-4 py-3 rounded-[2rem] mb-3 shadow-xl shadow-black/20">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="bg-black/5 py-3 rounded-2xl">
              <p className="text-[9px] text-black/50 font-black uppercase tracking-widest">XP Total</p>
              <p className="text-3xl font-black text-orange-500 tracking-tighter italic">{totalXp}</p>
            </div>
            <div className="bg-black/5 py-3 rounded-2xl">
              <p className="text-[9px] text-black/50 font-black uppercase tracking-widest">Racha</p>
              <p className="text-3xl font-black text-orange-500 tracking-tighter italic">
                0<span className="text-lg not-italic ml-1">🔥</span>
              </p>
            </div>
          </div>
        </div>

        {/* Misiones Diarias — altura acotada con scroll interno */}
        <div className="bg-white px-5 py-4 rounded-[2rem] mb-3 shadow-xl shadow-black/20">
          <h3 className="font-black text-black/40 uppercase text-[10px] tracking-[0.2em] mb-3">Misiones Diarias</h3>
          <div className="space-y-3 max-h-[22vh] overflow-y-auto">
            <MissionRow icon={missions.salALaCalle ? '✅' : '🚲'} title="Sal a la Calle"
              desc={missions.salALaCalle ? 'COMPLETADA' : 'Inicia y finaliza una salida hoy'} xp="+50 XP" done={missions.salALaCalle} />
            <MissionRow icon={missions.aveNocturna ? '✅' : '🌙'} title="Ave Nocturna"
              desc={missions.aveNocturna ? 'COMPLETADA' : 'Sal después de las 18:00 hrs'} xp="+100 XP" done={missions.aveNocturna} />
            <MissionRow icon={missions.sociable ? '✅' : '🤝'} title="Sociable"
              desc={missions.sociable ? 'COMPLETADA' : 'Tu primer encuentro callejero'} xp="+150 XP" done={missions.sociable} last />
          </div>
        </div>

        {/* Botones de acción — grid 2 columnas */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setShowMisiones(true)}
            className="bg-white text-black font-black py-4 rounded-[1.5rem] shadow-xl shadow-black/20 active:scale-95 transition-all border-none outline-none flex flex-col items-center justify-center gap-1"
          >
            <span className="text-2xl">🏅</span>
            <span className="font-black text-xs italic uppercase tracking-tight leading-none">Misiones</span>
            <span className="text-[9px] text-black/40 font-bold uppercase tracking-wider">Ver desafíos</span>
          </button>

          <button
            onClick={() => setShowEncounter(true)}
            className="bg-white text-black font-black py-4 rounded-[1.5rem] shadow-xl shadow-black/20 active:scale-95 transition-all border-none outline-none flex flex-col items-center justify-center gap-1"
          >
            <span className="text-2xl">🤝</span>
            <span className="font-black text-xs italic uppercase tracking-tight leading-none">Encuentro</span>
            <span className="text-[9px] text-black/40 font-bold uppercase tracking-wider">+50 XP</span>
          </button>
        </div>

      </div>{/* fin área scrollable */}

      {/* INICIAR SALIDA — fijo sobre el BottomNav */}
      <div className="fixed bottom-16 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black via-black/95 to-transparent z-40">
        <button
          onClick={onStart}
          className="w-full bg-orange-500 text-black font-black py-5 rounded-full shadow-2xl shadow-orange-500/50 text-xl italic uppercase tracking-widest active:scale-95 transition-all border-none outline-none"
        >
          INICIAR SALIDA
        </button>
      </div>

      {showEncounter && (
        <EncounterModal
          isFirstEncounter={!missions.sociable}
          onSuccess={onEncounter}
          onClose={() => setShowEncounter(false)}
        />
      )}

      <MisionesPanel
        isOpen={showMisiones}
        userClass={userClass}
        totalXp={totalXp}
        completedIds={completedMissionIds}
        onClose={() => setShowMisiones(false)}
      />
    </div>
  );
}

function MissionRow({ icon, title, desc, xp, done, last = false }: {
  icon: string; title: string; desc: string; xp: string; done: boolean; last?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${!last ? 'border-b border-black/5 pb-3' : ''} ${done ? 'opacity-50' : ''}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shadow-inner flex-shrink-0 ${done ? 'bg-green-100' : 'bg-orange-100'}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-black text-sm italic tracking-tight leading-none uppercase truncate">{title}</p>
        <p className="text-[10px] text-black/50 font-bold italic uppercase tracking-tight mt-0.5">{desc}</p>
      </div>
      <div className={`font-black text-sm italic flex-shrink-0 ${done ? 'text-green-500' : 'text-orange-500'}`}>
        {done ? '✓' : xp}
      </div>
    </div>
  );
}
