import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { calculateLevel } from '../lib/xp';

interface Mission {
  id: string;
  title: string;
  description: string;
  category: string;
  xp_reward: number;
  min_level: number;
  condition_type: string;
  condition_value: number;
}

interface Props {
  isOpen: boolean;
  userClass: string;
  totalXp: number;
  completedIds: number[];
  onClose: () => void;
}

export default function MisionesPanel({ isOpen, userClass, totalXp, completedIds, onClose }: Props) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(false);
  const userLevel = calculateLevel(totalXp);

  useEffect(() => {
    if (!isOpen || missions.length > 0) return;
    setLoading(true);
    supabase
      .from('missions')
      .select('*')
      .order('min_level', { ascending: true })
      .then(({ data, error }) => {
        if (error) console.warn('[MisionesPanel]', error.message);
        const filtered = (data ?? []).filter(
          (m: Mission) => m.category === 'Todas' || m.category === userClass
        );
        setMissions(filtered);
        setLoading(false);
      });
  }, [isOpen]);

  if (!isOpen) return null;

  const completed = missions.filter(m => completedIds.includes(Number(m.id)));
  const available = missions.filter(m => !completedIds.includes(Number(m.id)) && m.min_level <= userLevel);
  const locked    = missions.filter(m => !completedIds.includes(Number(m.id)) && m.min_level > userLevel);

  return (
    /* Overlay — z-[100] para estar sobre BottomNav (z-50) y cualquier otro elemento */
    <div
      className="fixed inset-0 flex items-end"
      style={{ background: 'rgba(0,0,0,0.75)', zIndex: 100 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Drawer — flex column: header fijo + lista scrollable */}
      <div
        className="w-full flex flex-col"
        style={{
          background: '#111',
          borderRadius: '2rem 2rem 0 0',
          border: '1.5px solid #F97316',
          borderBottom: 'none',
          minHeight: '85vh',
          maxHeight: '92vh',
        }}
      >
        {/* Handle + Header — flex-shrink-0 para que no ceda */}
        <div className="flex-shrink-0 px-6 pt-4 pb-3" style={{ background: '#111' }}>
          <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: '#F97316', opacity: 0.5 }} />
          <div className="flex justify-between items-center">
            <div>
              <p style={{ color: '#F97316', fontSize: '11px', fontWeight: 900, letterSpacing: '0.25em', textTransform: 'uppercase' }}>
                ¿Cuánta Calle tienes?
              </p>
              <h2 style={{ color: 'white', fontSize: '26px', fontWeight: 900, fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.03em', lineHeight: 1 }}>
                Misiones
              </h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
              <span style={{ background: '#F97316', color: 'black', borderRadius: '999px', padding: '4px 12px', fontWeight: 900, fontSize: '11px', fontStyle: 'italic' }}>
                LVL {userLevel}
              </span>
              <button
                onClick={onClose}
                style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 900, fontSize: '18px', lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Contadores rápidos */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            {[
              { label: 'Disponibles', count: available.length, color: '#F97316' },
              { label: 'Completadas', count: completed.length, color: '#22C55E' },
              { label: 'Bloqueadas',  count: locked.length,    color: 'rgba(255,255,255,0.2)' },
            ].map(({ label, count, color }) => (
              <div key={label} style={{ flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: '1rem', padding: '8px', textAlign: 'center' }}>
                <p style={{ color, fontWeight: 900, fontSize: '20px', fontStyle: 'italic' }}>{count}</p>
                <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Lista — flex-1 + overflow-y-auto: scroll interno sin romper el panel */}
        <div className="flex-1 overflow-y-auto px-4 pt-2 pb-8">
          {loading && (
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px', fontWeight: 700, textAlign: 'center', padding: '32px', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
              Cargando misiones...
            </p>
          )}

          {/* Disponibles */}
          {available.length > 0 && (
            <Section title="Disponibles" accent="#F97316">
              {available.map(m => <MissionCard key={m.id} m={m} status="available" />)}
            </Section>
          )}

          {/* Completadas */}
          {completed.length > 0 && (
            <Section title="Completadas" accent="#22C55E">
              {completed.map(m => <MissionCard key={m.id} m={m} status="done" />)}
            </Section>
          )}

          {/* Bloqueadas */}
          {locked.length > 0 && (
            <Section title="Bloqueadas" accent="rgba(255,255,255,0.2)">
              {locked.map(m => <MissionCard key={m.id} m={m} status="locked" />)}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '24px' }}>
      <p style={{ color: accent, fontSize: '10px', fontWeight: 900, letterSpacing: '0.25em', textTransform: 'uppercase', marginBottom: '10px', paddingLeft: '4px' }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {children}
      </div>
    </div>
  );
}

function MissionCard({ m, status }: { m: Mission; status: 'available' | 'done' | 'locked' }) {
  const isDone    = status === 'done';
  const isLocked  = status === 'locked';
  const opacity   = isLocked ? 0.4 : isDone ? 0.6 : 1;

  const statusLabel = isDone ? 'Completada' : isLocked ? `LVL ${m.min_level} requerido` : 'Disponible';
  const statusColor = isDone ? '#22C55E' : isLocked ? 'rgba(255,255,255,0.3)' : '#F97316';
  const iconBg      = isDone ? 'rgba(34,197,94,0.15)' : isLocked ? 'rgba(255,255,255,0.05)' : 'rgba(249,115,22,0.15)';

  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: `1px solid ${isDone ? 'rgba(34,197,94,0.3)' : isLocked ? 'rgba(255,255,255,0.08)' : 'rgba(249,115,22,0.3)'}`,
      borderRadius: '1.25rem',
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      opacity,
    }}>
      {/* Icono */}
      <div style={{ width: '44px', height: '44px', borderRadius: '0.75rem', background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0 }}>
        {isDone ? '✅' : isLocked ? '🔒' : '⭐'}
      </div>

      {/* Texto */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ color: 'white', fontWeight: 900, fontSize: '14px', fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 1.1 }}>
          {m.title}
        </p>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontWeight: 600, marginTop: '3px' }}>
          {m.description}
        </p>
        <p style={{ color: statusColor, fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '4px' }}>
          {statusLabel}
        </p>
      </div>

      {/* XP */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <p style={{ color: isDone ? '#22C55E' : isLocked ? 'rgba(255,255,255,0.2)' : '#F97316', fontWeight: 900, fontSize: '16px', fontStyle: 'italic' }}>
          +{m.xp_reward}
        </p>
        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' }}>XP</p>
      </div>
    </div>
  );
}
