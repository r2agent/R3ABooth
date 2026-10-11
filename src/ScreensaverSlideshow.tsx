import { useEffect, useMemo, useState } from 'react';

type Props = {
  slideDurationSec: number;
  onDismiss: () => void;
};

// Auto-import semua foto dari src/assets/screensaver/
// Vite akan scan folder saat build time.
const modules = import.meta.glob('./assets/screensaver/*.{jpg,jpeg,png,JPG,JPEG,PNG}', {
  eager: true,
  as: 'url',
}) as Record<string, string>;

export const ScreensaverSlideshow = ({ slideDurationSec, onDismiss }: Props) => {
  const photos = useMemo(() => {
    return Object.entries(modules)
      .sort(([a], [b]) => a.localeCompare(b))  // urut sesuai nama file
      .map(([, url]) => url);
  }, []);

  const [index, setIndex] = useState(0);

  // Ganti foto tiap slideDurationSec
  useEffect(() => {
    if (photos.length <= 1) return;
    const interval = Math.max(1, slideDurationSec) * 1000;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % photos.length);
    }, interval);
    return () => clearInterval(id);
  }, [photos.length, slideDurationSec]);

  // Dismiss saat klik / tap di mana saja
  const handleDismiss = () => onDismiss();

  // Kalau tidak ada foto → fallback layar hitam
  if (photos.length === 0) {
    return (
      <div
        onClick={handleDismiss}
        onTouchStart={handleDismiss}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999999,
          background: '#000',
          cursor: 'pointer',
        }}
      />
    );
  }

  return (
    <div
      onClick={handleDismiss}
      onTouchStart={handleDismiss}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999999,
        background: '#000',
        cursor: 'pointer',
        overflow: 'hidden',
      }}
    >
      {/* Foto slideshow — fit to screen */}
      {photos.map((url, i) => (
        <img
          key={url}
          src={url}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',        // fit to screen (tidak crop)
            opacity: i === index ? 1 : 0,
            transition: 'opacity 0.8s ease-in-out',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* Tulisan TAP ANYWHERE mengambang */}
      <div
        style={{
          position: 'absolute',
          bottom: 48,
          left: '50%',
          transform: 'translateX(-50%)',
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
          pointerEvents: 'none',
          animation: 'r3a-float 2.2s ease-in-out infinite',
          backdropFilter: 'blur(4px)',
        }}
      >
        TAP ANYWHERE
      </div>

      {/* Keyframes untuk animasi mengambang */}
      <style>{`
        @keyframes r3a-float {
          0%, 100% { transform: translateX(-50%) translateY(0); opacity: 0.9; }
          50% { transform: translateX(-50%) translateY(-10px); opacity: 1; }
        }
      `}</style>
    </div>
  );
};