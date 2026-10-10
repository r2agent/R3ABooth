import { useEffect, useRef } from 'react';
import { AlertCircle, RefreshCw, X, Loader2 } from 'lucide-react';

type Props = {
  minutesUntilExpiry: number;
  hasRefreshToken: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onDismiss: () => void;
  soundEnabled?: boolean;
  /** Kalau true → popup jadi fullscreen overlay (untuk mode booth/kiosk) */
  waitingForOAuth?: boolean;
};

function playBeep() {
  try {
    type WindowWithAudio = Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const w = window as WindowWithAudio;
    const Ctx = w.AudioContext || w.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch { /* ignore */ }
}

export const ReminderPopup = ({
  minutesUntilExpiry,
  refreshing,
  onRefresh,
  onDismiss,
  soundEnabled = true,
  waitingForOAuth = false,
}: Props) => {
  const playedRef = useRef(false);

  useEffect(() => {
    if (playedRef.current) return;
    playedRef.current = true;
    if (soundEnabled && !waitingForOAuth) {
      playBeep();
    }
  }, [soundEnabled, waitingForOAuth]);

  const expired = minutesUntilExpiry <= 0;

  // === FULLSCREEN WAITING MODE ===
  if (waitingForOAuth) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          color: '#fff',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <Loader2
          size={64}
          color="#ef3f25"
          style={{ animation: 'spin 1.2s linear infinite', marginBottom: 24 }}
        />
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '.05em', marginBottom: 12 }}>
          WAITING FOR GOOGLE LOGIN
        </div>
        <div style={{ fontSize: 15, color: 'rgba(255,255,255,.65)', maxWidth: 480, lineHeight: 1.6 }}>
          Selesaikan login di jendela Google yang baru terbuka.
          <br />
          Setelah selesai, halaman ini akan kembali otomatis.
        </div>
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // === NORMAL POPUP MODE (tengah) ===
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.55)',
      }}
      onClick={onDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '90%',
          maxWidth: 520,
          background: '#1a1a1a',
          border: '2px solid #ef3f25',
          borderRadius: 8,
          padding: '24px 24px 20px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
          color: '#fff',
          fontFamily: 'inherit',
          position: 'relative',
        }}
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,.5)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X size={22} />
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <AlertCircle size={36} color="#ef3f25" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8, letterSpacing: '.05em' }}>
              {expired ? 'GOOGLE DRIVE TOKEN EXPIRED' : 'GOOGLE DRIVE TOKEN EXPIRING'}
            </div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,.75)', marginBottom: 20, lineHeight: 1.5 }}>
              {expired
                ? 'Token sudah habis. Upload ke Drive berhenti. Klik REFRESH NOW untuk login ulang.'
                : `Token akan habis dalam ${minutesUntilExpiry} menit. Klik REFRESH NOW untuk memperbarui.`}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                style={{
                  flex: 1,
                  padding: '12px 18px',
                  background: refreshing ? '#555' : '#ef3f25',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: refreshing ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <RefreshCw size={16} />
                {refreshing ? 'REFRESHING...' : 'REFRESH NOW'}
              </button>
              <button
                type="button"
                onClick={onDismiss}
                style={{
                  padding: '12px 20px',
                  background: 'transparent',
                  color: 'rgba(255,255,255,.7)',
                  border: '1px solid rgba(255,255,255,.25)',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                LATER
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};