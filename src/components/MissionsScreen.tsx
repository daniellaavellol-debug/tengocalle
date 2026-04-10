import { useState } from 'react';
import { useMissions } from '../hooks/useMissions';
import { useMissionFeedback } from '../hooks/useMissionFeedback';
import type { VoteType } from '../hooks/useMissionFeedback';
import type { MissionWithProgress, Difficulty, MissionType } from '../types/missions';
import {
  normalizeDifficulty, missionTribe, progressPercent,
  TRIBE_COLORS, DIFFICULTY_COLORS, DIFFICULTY_LABELS, TYPE_LABELS,
} from '../types/missions';

interface Props {
  userClass: string;
  totalXp: number;
  userId: string | null;
  completedMissionIds: number[];
  onBack: () => void;
}

// ─── Chips de dificultad y tipo (solo visuales — no filtran) ──────────────────

type DiffFilter = Difficulty | 'all';
type TypeFilter = MissionType | 'all';

const DIFF_FILTERS: Array<{ value: DiffFilter; label: string }> = [
  { value: 'all',    label: 'Todas' },
  { value: 'easy',   label: 'Fácil' },
  { value: 'medium', label: 'Media' },
  { value: 'hard',   label: 'Épica' },
];

const TYPE_FILTERS: Array<{ value: TypeFilter; label: string }> = [
  { value: 'all',         label: 'Todos' },
  { value: 'distance',    label: 'Distancia' },
  { value: 'duration',    label: 'Duración' },
  { value: 'speed',       label: 'Velocidad' },
  { value: 'social',      label: 'Social' },
  { value: 'streak',      label: 'Racha' },
  { value: 'time_of_day', label: 'Horario' },
];

// Normaliza el valor de tribu de la DB a un string display canónico
function normalizeTribeDisplay(raw: string | undefined): string {
  const lower = (raw ?? '').toLowerCase().trim();
  if (!lower || lower === 'all' || lower === 'todas') return 'Todas';
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export default function MissionsScreen({ userClass, userId, onBack }: Props) {
  // Estado local de chips — solo para resaltar, no para filtrar
  const [diffFilter, setDiffFilter] = useState<DiffFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  // missions = filteredMissions en modo catálogo (sin filtrado en el hook)
  const { missions, loading, error } = useMissions(userId);
  const { votes, submitFeedback, toastVisible } = useMissionFeedback(userId);

  // Stats sobre el total
  const completed  = missions.filter(m => m.userMission?.status === 'completed').length;
  const inProgress = missions.filter(m => m.userMission?.status === 'in_progress').length;
  const tribeColor = TRIBE_COLORS[userClass] ?? TRIBE_COLORS.Todas;

  // Determina si una misión "encaja" con los chips activos (para resaltarla)
  const isHighlighted = (m: MissionWithProgress): boolean => {
    const diffOk = diffFilter === 'all' || normalizeDifficulty(m) === diffFilter;
    const typeOk = typeFilter === 'all' || (m.type ?? m.condition_type ?? '').toLowerCase().trim() === typeFilter;
    return diffOk && typeOk;
  };
  const anyFilterActive = diffFilter !== 'all' || typeFilter !== 'all';

  return (
    <div style={{
      width: '100vw', height: '100vh', background: '#080c14',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>

      {/* ── HEADER ── */}
      <div style={{ flexShrink: 0, padding: '20px 20px 0' }}>

        {/* Nav row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <button onClick={onBack} style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.7)', borderRadius: '999px', padding: '8px 18px',
            fontWeight: 900, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '2px',
            cursor: 'pointer', fontStyle: 'italic',
          }}>
            ← Volver
          </button>
          <span style={{
            background: tribeColor.bg, color: tribeColor.text,
            borderRadius: '999px', padding: '6px 14px',
            fontWeight: 900, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '2px',
          }}>
            {userClass || 'Callejero'}
          </span>
        </div>

        {/* Título */}
        <p style={{ color: '#FF5F1F', fontSize: '10px', fontWeight: 900, letterSpacing: '0.3em', textTransform: 'uppercase', marginBottom: '2px' }}>
          ¿Cuánta Calle tienes?
        </p>
        <h1 style={{ color: '#fff', fontSize: '30px', fontWeight: 900, fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: '14px' }}>
          Misiones
        </h1>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          {[
            { label: 'Total',       value: missions.length, color: 'rgba(255,255,255,0.5)' },
            { label: 'En Progreso', value: inProgress,      color: '#F59E0B' },
            { label: 'Completadas', value: completed,        color: '#10B981' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '1rem', padding: '10px 8px', textAlign: 'center',
            }}>
              <p style={{ color, fontWeight: 900, fontSize: '20px', fontStyle: 'italic', lineHeight: 1 }}>{value}</p>
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: '3px' }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Chips de dificultad — resaltan, no filtran */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', overflowX: 'auto', paddingBottom: '2px' }}>
          {DIFF_FILTERS.map(f => (
            <FilterChip
              key={f.value}
              label={f.label}
              active={diffFilter === f.value}
              color={f.value === 'all' ? '#FF5F1F' : DIFFICULTY_COLORS[f.value as Difficulty]}
              onClick={() => setDiffFilter(f.value)}
            />
          ))}
        </div>

        {/* Chips de tipo — resaltan, no filtran */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', overflowX: 'auto', paddingBottom: '2px' }}>
          {TYPE_FILTERS.map(f => (
            <FilterChip
              key={f.value}
              label={f.label}
              active={typeFilter === f.value}
              color='rgba(255,255,255,0.5)'
              onClick={() => setTypeFilter(f.value)}
            />
          ))}
        </div>

        <div style={{ height: '1px', background: 'linear-gradient(to right, transparent, rgba(249,115,22,0.3), transparent)', marginBottom: '4px' }} />
      </div>

      {/* ── TOAST FEEDBACK ── */}
      {toastVisible && (
        <div style={{
          position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, pointerEvents: 'none',
          background: 'rgba(8,12,20,0.97)',
          border: '1px solid rgba(255,95,31,0.5)',
          borderRadius: '999px', padding: '10px 22px',
          display: 'flex', alignItems: 'center', gap: '8px',
          boxShadow: '0 4px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,95,31,0.15)',
          animation: 'fadeInUp 0.22s ease',
          whiteSpace: 'nowrap',
        }}>
          <style>{`@keyframes fadeInUp{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>
          <span style={{ fontSize: '14px' }}>🎯</span>
          <span style={{ color: '#fff', fontSize: '12px', fontWeight: 700, letterSpacing: '0.02em' }}>
            ¡Gracias! Tu opinión nos ayuda a mejorar las misiones
          </span>
        </div>
      )}

      {/* ── LISTA — TODAS LAS MISIONES ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 20px 40px' }}>

        {loading && (
          <div style={{ textAlign: 'center', paddingTop: '3rem', color: 'rgba(255,255,255,0.2)', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            Cargando misiones...
          </div>
        )}

        {error && (
          <div style={{ textAlign: 'center', paddingTop: '3rem', color: '#f87171', fontSize: '0.8rem', fontWeight: 700 }}>
            Error: {error}
          </div>
        )}

        {!loading && !error && missions.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: '3rem', color: 'rgba(255,255,255,0.2)', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em' }}>
            Sin misiones en la base de datos
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {missions.map(m => (
            <MissionCard
              key={m.id}
              mission={m}
              userClass={userClass}
              vote={votes[m.id]}
              onFeedback={submitFeedback}
              hasUser={!!userId}
              highlighted={isHighlighted(m)}
              dimmed={anyFilterActive && !isHighlighted(m)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── FilterChip ───────────────────────────────────────────────────────────────
function FilterChip({ label, active, color, onClick }: {
  label: string; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0,
        background: active ? `${color}22` : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? color : 'rgba(255,255,255,0.1)'}`,
        color: active ? color : 'rgba(255,255,255,0.4)',
        borderRadius: '999px', padding: '5px 12px',
        fontWeight: 700, fontSize: '10px', textTransform: 'uppercase',
        letterSpacing: '0.1em', cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

// ─── MissionCard ──────────────────────────────────────────────────────────────
function MissionCard({ mission: m, userClass, vote, onFeedback, hasUser, highlighted, dimmed }: {
  mission: MissionWithProgress;
  userClass: string;
  vote: VoteType | undefined;
  onFeedback: (missionId: number, voteType: VoteType, userClass: string) => void;
  hasUser: boolean;
  highlighted: boolean;
  dimmed: boolean;
}) {
  const diff      = normalizeDifficulty(m);
  const diffColor = DIFFICULTY_COLORS[diff];

  // Tribu de la misión — normalizada para display
  const tribeRaw     = missionTribe(m);
  const tribeDisplay = normalizeTribeDisplay(tribeRaw);
  const isUserTribe  = tribeDisplay === 'Todas' || tribeDisplay.toLowerCase() === userClass.toLowerCase();
  const tribeColor   = TRIBE_COLORS[tribeDisplay] ?? TRIBE_COLORS[userClass] ?? TRIBE_COLORS.Todas;

  const status    = m.userMission?.status ?? 'not_started';
  const pct       = progressPercent(m);
  const isDone    = status === 'completed';
  const isWip     = status === 'in_progress';

  const statusIcon  = isDone ? '✓' : isWip ? '◐' : '○';
  const statusColor = isDone ? '#10B981' : isWip ? '#F59E0B' : 'rgba(255,255,255,0.2)';

  const target    = m.target_value ?? m.condition_value;
  const typeRaw   = (m.type ?? m.condition_type ?? '').toLowerCase().trim();
  const typeLabel = TYPE_LABELS[typeRaw] ?? typeRaw;

  // Borde: si está resaltado, orange glow; si completado, verde; si dimmed, muy sutil
  const borderColor = isDone
    ? 'rgba(16,185,129,0.4)'
    : highlighted
    ? '#FF5F1F'
    : dimmed
    ? 'rgba(255,255,255,0.06)'
    : 'rgba(255,255,255,0.1)';

  return (
    <div style={{
      background: isDone
        ? 'rgba(16,185,129,0.04)'
        : highlighted
        ? 'rgba(255,95,31,0.04)'
        : 'rgba(255,255,255,0.025)',
      border: `1.5px solid ${borderColor}`,
      borderRadius: '1.25rem', padding: '14px 16px',
      opacity: dimmed ? 0.3 : 1,
      transition: 'opacity 0.2s, border-color 0.2s, background 0.2s',
      boxShadow: highlighted && !isDone ? '0 0 14px rgba(255,95,31,0.12)' : 'none',
    }}>

      {/* Fila principal */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>

        {/* Status icon */}
        <div style={{
          width: '36px', height: '36px', flexShrink: 0, borderRadius: '50%',
          border: `2px solid ${statusColor}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: statusColor, fontWeight: 900, fontSize: '14px',
        }}>
          {statusIcon}
        </div>

        {/* Contenido */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Título + badges de dificultad, tribu y tipo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <p style={{
              color: isDone ? '#10B981' : '#fff', fontWeight: 900, fontSize: '13px',
              fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 1.1,
              marginRight: '2px',
            }}>
              {m.title}
            </p>

            {/* Badge dificultad */}
            <span style={{
              fontSize: '8px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em',
              color: diffColor, border: `1px solid ${diffColor}55`,
              borderRadius: '999px', padding: '1px 6px', flexShrink: 0,
            }}>
              {DIFFICULTY_LABELS[diff]}
            </span>

            {/* Badge tribu */}
            <span style={{
              fontSize: '8px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em',
              color: isUserTribe ? tribeColor.text : 'rgba(255,255,255,0.4)',
              background: isUserTribe ? tribeColor.bg : 'rgba(255,255,255,0.08)',
              borderRadius: '999px', padding: '1px 6px', flexShrink: 0,
            }}>
              {tribeDisplay}
            </span>

            {/* Badge tipo */}
            {typeLabel && (
              <span style={{
                fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
                color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '999px', padding: '1px 6px', flexShrink: 0,
              }}>
                {typeLabel}
              </span>
            )}
          </div>

          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontWeight: 600, lineHeight: 1.3, marginBottom: '6px' }}>
            {m.description}
          </p>

          {/* Objetivo */}
          {target != null && (
            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Objetivo: {target} {m.target_unit ?? ''}
            </span>
          )}

          {/* Barra de progreso */}
          {isWip && (
            <div style={{ height: '3px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden', marginTop: '8px' }}>
              <div style={{
                height: '100%', width: `${pct}%`,
                background: `linear-gradient(to right, #FF5F1F, ${diffColor})`,
                borderRadius: '2px', transition: 'width 0.4s ease',
              }} />
            </div>
          )}
          {isDone && (
            <div style={{ height: '3px', background: 'rgba(16,185,129,0.3)', borderRadius: '2px', marginTop: '8px' }}>
              <div style={{ height: '100%', width: '100%', background: '#10B981', borderRadius: '2px' }} />
            </div>
          )}
        </div>

        {/* XP */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{
            fontWeight: 900, fontSize: '16px', fontStyle: 'italic', lineHeight: 1,
            color: isDone ? '#10B981' : '#FF5F1F',
          }}>
            +{m.xp_reward}
          </p>
          <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>XP</p>
          {isDone && m.userMission?.completed_at && (
            <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: '8px', fontWeight: 600, marginTop: '4px' }}>
              {new Date(m.userMission.completed_at).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })}
            </p>
          )}
        </div>
      </div>

      {/* ── Feedback ── */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
        gap: '6px', marginTop: '10px',
        borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px',
      }}>
        <FeedbackBtn
          type="like"
          active={vote === 'like'}
          disabled={!hasUser}
          onClick={() => hasUser && onFeedback(m.id, 'like', userClass)}
        />
        <FeedbackBtn
          type="dislike"
          active={vote === 'dislike'}
          disabled={!hasUser}
          onClick={() => hasUser && onFeedback(m.id, 'dislike', userClass)}
        />
      </div>
    </div>
  );
}

// ─── FeedbackBtn ──────────────────────────────────────────────────────────────
function FeedbackBtn({ type, active, disabled, onClick }: {
  type: 'like' | 'dislike';
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const isLike      = type === 'like';
  const activeColor = isLike ? '#FF5F1F' : '#64748b';
  const activeBg    = isLike ? 'rgba(255,95,31,0.14)' : 'rgba(100,116,139,0.18)';
  const activeText  = isLike ? '#FF5F1F' : '#94a3b8';

  return (
    <button
      onClick={onClick}
      title={disabled ? 'Inicia sesión para votar' : isLike ? 'Me gusta esta misión' : 'No me convence'}
      style={{
        display: 'flex', alignItems: 'center',
        background: active ? activeBg : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? activeColor : 'rgba(255,255,255,0.09)'}`,
        color: active ? activeText : 'rgba(255,255,255,0.25)',
        borderRadius: '999px', padding: '4px 13px',
        fontSize: '13px', fontWeight: 700,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
        outline: 'none',
      }}
    >
      {isLike ? '👍' : '👎'}
    </button>
  );
}

