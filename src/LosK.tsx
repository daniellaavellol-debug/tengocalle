export default function LosK() {
  return (
    <div className="h-full w-full bg-black text-white flex flex-col overflow-y-auto pb-20">

      {/* Hero */}
      <div className="relative flex flex-col items-center justify-center px-6 pt-16 pb-10 text-center overflow-hidden">
        {/* Fondo decorativo */}
        <div className="absolute inset-0 flex items-center justify-center opacity-5 pointer-events-none select-none">
          <span className="text-[18rem] font-black italic leading-none tracking-tighter">K</span>
        </div>

        <p className="text-orange-500 font-black text-[11px] uppercase tracking-[0.35em] mb-3 z-10">
          Fase 2 · Comunidad
        </p>
        <h1 className="text-4xl font-black italic uppercase tracking-tighter leading-[0.9] mb-4 z-10">
          LA CALLE SE<br />TOMA EN TRIBU
        </h1>
        <p className="text-white/40 text-sm font-medium max-w-xs leading-relaxed z-10">
          El poder de los tres. Cuando un Ciclista, un Runner y un Roller se unen, nace algo distinto.
        </p>
      </div>

      {/* Tarjeta explicativa principal */}
      <div className="bg-white text-black mx-4 rounded-[2.5rem] p-6 mb-4 shadow-xl shadow-black/20">
        <h2 className="font-black text-xl italic uppercase tracking-tight mb-4">¿Qué es LosK?</h2>
        <p className="text-black/70 text-sm leading-relaxed font-medium">
          Únete a un equipo con las <span className="font-black text-black">3 clases</span> (Ciclista, Runner, Roller)
          para activar el <span className="font-black text-orange-500">modo LosK</span>.{' '}
          Multiplica tus puntos, cumple misiones grupales de{' '}
          <span className="font-black text-black">30 KM</span> y rescata las rachas perdidas
          de tus compañeros.
        </p>
      </div>

      {/* Cards de features */}
      <div className="grid grid-cols-1 gap-3 mx-4 mb-4">
        <FeatureCard
          icon="⚡"
          title="XP Multiplicado"
          desc="Todo el equipo suma. Si un compañero sale, tú ganas también."
        />
        <FeatureCard
          icon="🗺️"
          title="Misiones Grupales"
          desc="30 KM en equipo para desbloquear recompensas exclusivas de barrio."
        />
        <FeatureCard
          icon="🔥"
          title="Rescate de Racha"
          desc="¿Perdiste tu racha? Tus compañeros pueden rescatarla por ti."
        />
      </div>

      {/* Clases requeridas */}
      <div className="bg-white/5 border border-white/10 mx-4 rounded-[2rem] p-5 mb-6">
        <p className="text-white/40 font-black text-[10px] uppercase tracking-[0.2em] mb-3">
          Composición requerida
        </p>
        <div className="flex justify-around text-center">
          {[['🚲', 'Ciclista'], ['🏃', 'Runner'], ['🛼', 'Roller']].map(([icon, name]) => (
            <div key={name} className="flex flex-col items-center gap-1">
              <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-2xl">
                {icon}
              </div>
              <span className="text-white/60 text-[10px] font-black uppercase tracking-widest">{name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Botón desactivado */}
      <div className="px-4">
        <button
          disabled
          className="w-full bg-white/10 text-white/30 font-black py-6 rounded-full text-base italic uppercase tracking-widest border-none outline-none cursor-not-allowed"
        >
          PRÓXIMAMENTE EN FASE 2
        </button>
        <p className="text-center text-white/20 text-xs font-bold uppercase tracking-widest mt-3">
          Sé el primero cuando abramos · Únete a la lista
        </p>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-[1.5rem] p-5 flex items-start gap-4">
      <div className="w-11 h-11 rounded-2xl bg-orange-500/20 flex items-center justify-center text-xl flex-shrink-0">
        {icon}
      </div>
      <div>
        <p className="font-black text-sm italic uppercase tracking-tight">{title}</p>
        <p className="text-white/40 text-xs font-medium leading-relaxed mt-0.5">{desc}</p>
      </div>
    </div>
  );
}
