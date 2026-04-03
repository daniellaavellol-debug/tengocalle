import { useState } from 'react';

type ClassType = 'Ciclista' | 'Runner' | 'Roller';

interface ClassSelectionProps {
  onSelect: (selectedClass: ClassType, multiplier: number) => void;
}

// Multiplicadores ocultos — no se muestran en la UI
const CLASS_CONFIG: Record<ClassType, { mult: number; icon: string; desc: string; flavor: string }> = {
  Ciclista: { mult: 1.0, icon: '🚲', desc: 'La ciudad es tu pista', flavor: 'Rodas la calle' },
  Runner:   { mult: 1.2, icon: '🏃', desc: 'Tus pies conocen cada barrio', flavor: 'Corres la calle' },
  Roller:   { mult: 1.5, icon: '🛼', desc: 'Deslizas la ciudad a tu ritmo', flavor: 'Ruedas la calle' },
};

export default function ClassSelection({ onSelect }: ClassSelectionProps) {
  const [selected, setSelected] = useState<ClassType | null>(null);

  const classes = Object.entries(CLASS_CONFIG) as [ClassType, typeof CLASS_CONFIG[ClassType]][];

  return (
    <div className="h-full w-full bg-black text-white p-8 flex flex-col justify-center items-center">

      <p className="text-orange-500 font-black text-[11px] uppercase tracking-[0.3em] mb-2">
        ¿Cuánta Calle tienes?
      </p>
      <h2 className="text-3xl font-black italic mb-2 uppercase tracking-tighter text-white">
        Elige tu Identidad
      </h2>
      <p className="text-white/40 mb-10 text-center text-sm font-medium tracking-tight">
        Cada clase tiene su propia manera de conquistar la ciudad
      </p>

      <div className="w-full max-w-sm space-y-4">
        {classes.map(([name, cfg]) => (
          <button
            key={name}
            onClick={() => {
              setSelected(name);
              setTimeout(() => onSelect(name, cfg.mult), 180);
            }}
            className={`w-full p-6 rounded-[2rem] flex items-center gap-5 transition-all active:scale-95 shadow-xl border-none outline-none
              ${selected === name
                ? 'bg-orange-500 text-black scale-[1.02]'
                : 'bg-white text-black hover:bg-orange-50'
              }`}
          >
            <span className="text-4xl">{cfg.icon}</span>
            <div className="text-left flex-1">
              <p className="font-black text-xl uppercase italic leading-none tracking-tight">{name}</p>
              <p className="text-xs opacity-60 font-bold tracking-tight mt-0.5">{cfg.desc}</p>
            </div>
            <div className={`font-black text-xs uppercase italic tracking-widest ${
              selected === name ? 'text-black/70' : 'text-orange-500'
            }`}>
              {cfg.flavor}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
