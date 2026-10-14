/* ============================================================
   IG FOLLOW GATE — popup full-screen sebelum photobooth start
   Muncul saat user tap frame (v1.0.0 only)
   Full screen seperti screensaver + animasi masuk
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
        animation: 'r3a-gate-fade-in .35s ease-out',
      }}
    >
      {/* Image full screen — dengan zoom in halus */}
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
          animation: 'r3a-gate-zoom-in .6s cubic-bezier(.22,.61,.36,1)',
        }}
      />

      {/* Gradient bawah */}
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
          animation: 'r3a-gate-fade-in .5s ease-out .15s backwards',
        }}
      />

      {/* Konten teks di bawah */}
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
            animation: 'r3a-gate-slide-up .5s cubic-bezier(.22,.61,.36,1) .2s backwards',
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
            backdropFilter: 'blur(4px)',
            animation: 'r3a-gate-pop-in .5s cubic-bezier(.22,.61,.36,1) .35s backwards, r3a-float 2.2s ease-in-out 1s infinite',
          }}
        >
          TAP ANYWHERE
        </div>
      </div>

      <style>{`
        /* Overlay fade in */
        @keyframes r3a-gate-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        /* Image zoom in halus */
        @keyframes r3a-gate-zoom-in {
          from {
            opacity: 0;
            transform: scale(1.08);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        /* Teks slide dari bawah */
        @keyframes r3a-gate-slide-up {
          from {
            opacity: 0;
            transform: translateY(40px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* Pill pop in */
        @keyframes r3a-gate-pop-in {
          0% {
            opacity: 0;
            transform: scale(.7);
          }
          60% {
            transform: scale(1.05);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }

        /* Floating animation (setelah pop in) */
        @keyframes r3a-float {
          0%, 100% { transform: translateY(0); opacity: 0.9; }
          50% { transform: translateY(-8px); opacity: 1; }
        }
      `}</style>
    </div>
  );
};