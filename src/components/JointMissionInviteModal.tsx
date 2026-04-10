/**
 * JointMissionInviteModal — Overlay cyan que aparece cuando B recibe una
 * invitación de Misión Conjunta estando fuera del mapa.
 *
 * El fondo oscuro con acento cyan es coherente con el color de misión conjunta
 * ya usado en MapboxTracking (ruta cian, HUD cian).
 */

interface Props {
  initiatorName: string;
  accepting:     boolean;
  onAccept:      () => void;
  onReject:      () => void;
}

export default function JointMissionInviteModal({
  initiatorName,
  accepting,
  onAccept,
  onReject,
}: Props) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900,
      background: 'rgba(0, 10, 20, 0.88)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      backdropFilter: 'blur(6px)',
    }}>
      <div style={{
        width: '100%', maxWidth: '440px',
        background: '#050d14',
        border: '2px solid #00FFFF',
        borderRadius: '2rem 2rem 0 0',
        padding: '2rem 1.75rem 3rem',
        boxShadow: '0 -12px 60px rgba(0, 255, 255, 0.2)',
        animation: 'slideUp 0.28s cubic-bezier(0.22,1,0.36,1)',
      }}>
        <style>{`
          @keyframes slideUp {
            from { transform: translateY(100%); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
          }
        `}</style>

        {/* Label */}
        <p style={{
          color: '#00FFFF', fontSize: '9px', fontWeight: 900,
          textTransform: 'uppercase', letterSpacing: '0.35em',
          marginBottom: '10px', textAlign: 'center',
        }}>
          Misión Conjunta
        </p>

        {/* Título */}
        <h2 style={{
          color: '#fff', fontSize: '1.9rem', fontWeight: 900,
          fontStyle: 'italic', textTransform: 'uppercase',
          letterSpacing: '-0.02em', lineHeight: 1,
          textAlign: 'center', marginBottom: '6px',
        }}>
          ¡{initiatorName}<br />te invita!
        </h2>
        <p style={{
          color: 'rgba(255,255,255,0.4)', fontSize: '12px',
          textAlign: 'center', marginBottom: '1.5rem',
        }}>
          Completen 3 km juntos y ganen XP doble
        </p>

        {/* Reward badge */}
        <div style={{
          background: 'rgba(0,255,255,0.07)',
          border: '1px solid rgba(0,255,255,0.25)',
          borderRadius: '1.25rem', padding: '1rem 1.25rem',
          display: 'flex', justifyContent: 'space-around',
          alignItems: 'center', marginBottom: '1.75rem',
        }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#00FFFF', fontSize: '1.75rem', fontWeight: 900, fontStyle: 'italic', lineHeight: 1 }}>×2</p>
            <p style={{ color: 'rgba(0,255,255,0.55)', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>XP</p>
          </div>
          <div style={{ width: '1px', height: '36px', background: 'rgba(0,255,255,0.2)' }} />
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#00FFFF', fontSize: '1.75rem', fontWeight: 900, fontStyle: 'italic', lineHeight: 1 }}>3 km</p>
            <p style={{ color: 'rgba(0,255,255,0.55)', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Objetivo</p>
          </div>
          <div style={{ width: '1px', height: '36px', background: 'rgba(0,255,255,0.2)' }} />
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#00FFFF', fontSize: '1.75rem', fontWeight: 900, fontStyle: 'italic', lineHeight: 1 }}>+50</p>
            <p style={{ color: 'rgba(0,255,255,0.55)', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Si rechazas</p>
          </div>
        </div>

        {/* Botones */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={onReject}
            disabled={accepting}
            style={{
              flex: 1,
              background: 'transparent',
              border: '1.5px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.45)',
              borderRadius: '999px', padding: '15px 0',
              fontWeight: 900, fontSize: '10px',
              textTransform: 'uppercase', letterSpacing: '0.15em',
              cursor: accepting ? 'default' : 'pointer',
              opacity: accepting ? 0.4 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            Rechazar (+50 XP)
          </button>

          <button
            onClick={onAccept}
            disabled={accepting}
            style={{
              flex: 2,
              background: '#00FFFF',
              border: 'none',
              color: '#000',
              borderRadius: '999px', padding: '15px 0',
              fontWeight: 900, fontSize: '12px',
              textTransform: 'uppercase', letterSpacing: '0.12em',
              cursor: accepting ? 'default' : 'pointer',
              opacity: accepting ? 0.6 : 1,
              boxShadow: accepting ? 'none' : '0 4px 28px rgba(0,255,255,0.45)',
              transition: 'opacity 0.15s, box-shadow 0.15s',
            }}
          >
            {accepting ? 'Activando...' : '¡Aceptar Misión!'}
          </button>
        </div>
      </div>
    </div>
  );
}
