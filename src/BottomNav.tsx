type Tab = 'home' | 'stats' | 'losk';

interface Props {
  current: Tab;
  onNavigate: (tab: Tab) => void;
}

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'home',  icon: '🏠', label: 'Inicio'   },
  { id: 'stats', icon: '👤', label: 'Tu Calle'  },
  { id: 'losk',  icon: '🏘',  label: 'LosK'     },
];

export default function BottomNav({ current, onNavigate }: Props) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-black border-t border-white/10 h-16 flex items-center justify-around px-2">
      {TABS.map((tab) => {
        const active = current === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onNavigate(tab.id)}
            className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-2 rounded-xl transition-all active:scale-90
              ${active ? 'text-orange-500' : 'text-white/30'}`}
          >
            <span className="text-xl leading-none">{tab.icon}</span>
            <span className={`text-[9px] font-black uppercase tracking-widest leading-none
              ${active ? 'text-orange-500' : 'text-white/30'}`}>
              {tab.label}
            </span>
            {active && (
              <span className="absolute bottom-1 w-1 h-1 rounded-full bg-orange-500" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
