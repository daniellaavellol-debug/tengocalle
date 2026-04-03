import { useEffect, useState } from 'react';

// Extiende Event para el evento no-estándar beforeinstallprompt
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Ignorar si ya está instalada (standalone) o ya fue descartada
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (localStorage.getItem('calle_install_dismissed')) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!deferredPrompt || dismissed) return null;

  const handleInstall = async () => {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') localStorage.setItem('calle_install_dismissed', '1');
    setDismissed(true);
  };

  const handleDismiss = () => {
    localStorage.setItem('calle_install_dismissed', '1');
    setDismissed(true);
  };

  return (
    <div
      className="fixed left-0 right-0 px-4 pb-4"
      style={{ bottom: '72px', zIndex: 150 }} // encima del BottomNav (z-50) pero debajo de modales (z-100)
    >
      <div className="bg-white rounded-[2rem] p-4 flex items-center gap-3 shadow-2xl shadow-black/50">
        {/* Icono */}
        <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center flex-shrink-0 shadow-inner">
          <span className="text-orange-500 font-black italic text-2xl leading-none">C</span>
        </div>

        {/* Texto */}
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm italic uppercase tracking-tight leading-none text-black">
            Instalar CALLE
          </p>
          <p className="text-[11px] text-black/50 font-bold mt-0.5">
            Agregar a pantalla de inicio
          </p>
        </div>

        {/* Botón instalar */}
        <button
          onClick={handleInstall}
          className="bg-orange-500 text-black font-black text-[11px] italic uppercase tracking-wider px-4 py-2.5 rounded-full border-none outline-none active:scale-95 transition-all flex-shrink-0 shadow-lg shadow-orange-500/30"
        >
          Instalar
        </button>

        {/* Cerrar */}
        <button
          onClick={handleDismiss}
          className="text-black/25 font-black text-xl leading-none bg-transparent border-none cursor-pointer flex-shrink-0 p-1"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
