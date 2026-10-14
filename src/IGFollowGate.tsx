/* ============================================================
   IG FOLLOW GATE — popup full-screen sebelum photobooth start
   Muncul saat user tap frame (v1.0.0 only)
   Full screen seperti screensaver + teks SUDAH FOLLOW?
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
        zIndex: 999999,
        background: '#000',
        cursor: 'pointer',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Image full screen — seperti screensaver */}
      <img
        src={imageSrc}
        alt="Follow Instagram"
        draggable={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      />

      {/* Gradient bawah — biar teks terbaca di atas image */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '40%',
          background: 'linear-gradient(to top, rgba(0,0,0,.9) 0%, rgba(0,0,0,.6) 40%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* Konten teks di bawah — SUDAH FOLLOW + TAP ANYWHERE */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '0 32px 48px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
          zIndex: 2,
          pointerEvents: 'none',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 'clamp(28px, 4vw, 48px)',
            fontWeight: 700,
            color: '#fff',
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            textShadow: '0 4px 20px rgba(0,0,0,.8)',
            textAlign: 'center',
          }}
        >
          SUDAH FOLLOW?
        </h2>

        <div
          style={{
            padding: '12px 28px',
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: 999,
            color: '#fff',
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: '.15em',
            textTransform: 'uppercase',
            fontFamily: 'inherit',
            animation: 'r3a-float 2.2s ease-in-out infinite',
            backdropFilter: 'blur(4px)',
          }}
        >
          TAP ANYWHERE
        </div>
      </div>

      <style>{`
        @keyframes r3a-float {
          0%, 100% { transform: translateY(0); opacity: 0.9; }
          50% { transform: translateY(-8px); opacity: 1; }
        }
      `}</style>
    </div>
  );
};