import { useState, useEffect } from 'react';
import { fetchMissionOfDay } from '../hooks/useMissions';
import type { Mission } from '../types/missions';
import { TRIBE_COLORS, DIFFICULTY_COLORS, normalizeDifficulty } from '../types/missions';

interface Props {
  userClass: string;
  alreadyCompleted: boolean;
}

export default function MissionOfDay({ userClass, alreadyCompleted }: Props) {
  const [mission, setMission] = useState<Mission | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userClass) return;
    fetchMissionOfDay(userClass).then(m => {
      setMission(m);
      setLoading(false);
    });
  }, [userClass]);

  const tribeColor  = TRIBE_COLORS[userClass] ?? TRIBE_COLORS.Todas;
  const diffColor   = mission ? DIFFICULTY_COLORS[normalizeDifficulty(mission)] : '#10B981';

  if (loading) {
    return (
      <div style={{
        background: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)',
        borderRadius: '1.5rem', padding: '1rem 1.25rem',
        display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '90px',
      }}>
        <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em' }}>
          Cargando misión del día...
        </span>
      </div>
    );
  }

  if (!mission) return null;

  const target = mission.target_value ?? mission.condition_value;
  const unit   = mission.target_unit ?? unitFromType(mission.type ?? mission.condition_type ?? '');

  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: `1.5px solid ${tribeColor.bg}44`,
      borderRadius: '1.5rem',
      padding: '1rem 1.25rem',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Glow accent */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
        background: tribeColor.bg, opacity: 0.7,
      }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
        <div>
          <p style={{
            color: tribeColor.bg, fontSize: '0.6rem', fontWeight: 900,
            letterSpacing: '0.25em', textTransform: 'uppercase', marginBottom: '0.2rem',
          }}>
            Misión del Día
          </p>
          <p style={{
            color: '#fff', fontSize: '0.95rem', fontWeight: 900,
            fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 1.1,
          }}>
            {mission.title}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem', flexShrink: 0 }}>
          {/* Dificultad badge */}
          <span style={{
            background: `${diffColor}22`, border: `1px solid ${diffColor}66`,
            color: diffColor, fontSize: '0.6rem', fontWeight: 900,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            borderRadius: '999px', padding: '2px 8px',
          }}>
            {normalizeDifficulty(mission) === 'easy' ? 'Fácil' : normalizeDifficulty(mission) === 'medium' ? 'Media' : 'Épica'}
          </span>
          {/* XP */}
          <span style={{ color: '#FF5F1F', fontWeight: 900, fontSize: '0.9rem', fontStyle: 'italic' }}>
            +{mission.xp_reward} XP
          </span>
        </div>
      </div>

      {/* Descripción */}
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem', fontWeight: 600, lineHeight: 1.4, marginBottom: '0.75rem' }}>
        {mission.description}
      </p>

      {/* Requisito */}
      {target != null && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
          background: 'rgba(255,255,255,0.06)', borderRadius: '0.5rem',
          padding: '0.25rem 0.6rem', marginBottom: '0.75rem',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Objetivo:
          </span>
          <span style={{ color: '#fff', fontSize: '0.75rem', fontWeight: 900, fontStyle: 'italic' }}>
            {target} {unit}
          </span>
        </div>
      )}

      {/* Estado de la misión — sin botón propio para no duplicar el CTA del footer */}
      {alreadyCompleted ? (
        <div style={{
          width: '100%', padding: '0.6rem', borderRadius: '0.75rem', textAlign: 'center',
          background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
          color: '#22C55E', fontWeight: 900, fontSize: '0.75rem',
          letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>
          ✓ Completada hoy
        </div>
      ) : (
        <div style={{
          width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.75rem',
          background: `${tribeColor.bg}18`, border: `1px solid ${tribeColor.bg}44`,
          display: 'flex', alignItems: 'center', gap: '0.4rem',
        }}>
          <span style={{ fontSize: '0.65rem', color: tribeColor.bg, opacity: 0.8 }}>▶</span>
          <span style={{
            color: 'rgba(255,255,255,0.5)', fontWeight: 700, fontSize: '0.7rem',
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>
            Pulsa <span style={{ color: tribeColor.bg, fontWeight: 900 }}>Iniciar Salida</span> para completarla
          </span>
        </div>
      )}
    </div>
  );
}

function unitFromType(type: string): string {
  switch (type) {
    case 'distance': case 'distance_km': return 'km';
    case 'duration': case 'duration_min': return 'min';
    case 'speed': return 'km/h';
    case 'streak': return 'días';
    default: return '';
  }
}
