import { useState, useEffect } from 'react';
import EncounterModal from './EncounterModal';
import MissionOfDay from './components/MissionOfDay';
import { getStreakDisplay } from './utils/streakLogic';

interface Props {
  userName: string;
  userClass: string;
  totalXp: number;
  userLevel: number;
  encounters: number;
  onStart: () => void;
  onEncounter: () => void;
  onMissions: () => void;
}

export default function Home({ userName, userClass, totalXp, userLevel, encounters, onStart, onEncounter, onMissions }: Props) {
  const [showEncounter, setShowEncounter] = useState(false);

  // Leer racha directamente de localStorage al montar — siempre refleja el último valor real
  const [streak, setStreak] = useState(0);
  const [completedToday, setCompletedToday] = useState(false);
  useEffect(() => {
    const { count, completedToday: done } = getStreakDisplay();
    setStreak(count);
    setCompletedToday(done);
  }, []);

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
            <div
              className="bg-black/5 py-3 rounded-2xl relative overflow-hidden"
              style={completedToday ? {
                background: 'rgba(255,95,31,0.08)',
                boxShadow: '0 0 18px rgba(255,95,31,0.35)',
                border: '1.5px solid rgba(255,95,31,0.4)',
              } : {}}
            >
              <p className="text-[9px] text-black/50 font-black uppercase tracking-widest">Racha</p>
              <p
                className="text-3xl font-black tracking-tighter italic"
                style={{ color: completedToday ? '#FF5F1F' : '#f97316' }}
              >
                {streak}
                <span
                  className="text-lg not-italic ml-1"
                  style={completedToday ? { filter: 'drop-shadow(0 0 6px #FF5F1F)' } : {}}
                >
                  🔥
                </span>
              </p>
              {completedToday && (
                <p className="text-[8px] font-black uppercase tracking-widest mt-0.5"
                   style={{ color: '#FF5F1F' }}>
                  ¡Hoy completada!
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Misión del Día — Supabase-driven */}
        <MissionOfDay userClass={userClass} alreadyCompleted={false} onStart={onStart} />

        {/* Botones de acción — grid 2 columnas */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onMissions}
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
          isFirstEncounter={encounters === 0}
          onSuccess={onEncounter}
          onClose={() => setShowEncounter(false)}
        />
      )}

      {/* MisionesPanel reemplazado por MissionsScreen (navegación via App.tsx) */}
    </div>
  );
}
