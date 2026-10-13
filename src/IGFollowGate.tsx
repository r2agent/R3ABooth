/* ============================================================
   IG FOLLOW GATE — popup full-screen sebelum photobooth start
   Muncul saat user tap frame (v1.0.0 only)
   ============================================================ */

type Props = {
  imageSrc: string;
  onDismiss: () => void;
};

export const IGFollowGate = ({ imageSrc, onDismiss }: Props) => {
  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483646,
        background: 'rgba(0,0,0,.88)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 32,
        animation: 'r3a-gate-fade .3s ease-out',
        userSelect: 'none',
      }}
    >
      <img
        src={imageSrc}
        alt="Follow Instagram"
        draggable={false}
        style={{
          maxWidth: '85vw',
          maxHeight: '65vh',
          objectFit: 'contain',
          animation: 'r3a-gate-zoom .4s ease-out',
          pointerEvents: 'none',
        }}
      />

      <div style={{ marginTop: 36, textAlign: 'center', pointerEvents: 'none' }}>
        <h2
          style={{
            margin: '0 0 10px',
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 'clamp(24px, 3.5vw, 40px)',
            fontWeight: 700,
            color: '#fff',
            letterSpacing: '.12em',
            textTransform: 'uppercase',
          }}
        >
          SUDAH FOLLOW?
        </h2>
        <p
          style={{
            margin: 0,
            color: 'rgba(255,255,255,.55)',
            fontSize: 'clamp(12px, 1.2vw, 15px)',
            letterSpacing: '.2em',
            fontWeight: 600,
          }}
        >
          TAP ANYWHERE UNTUK LANJUT
        </p>
      </div>

      <style>{`
        @keyframes r3a-gate-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes r3a-gate-zoom {
          from { transform: scale(.92); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};