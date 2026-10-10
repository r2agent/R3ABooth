import { useEffect, useRef } from 'react';
import { AlertCircle, RefreshCw, X } from 'lucide-react';

type Props = {
  /** Menit sampai token expired (bisa negatif kalau sudah expired) */
  minutesUntilExpiry: number;
  /** Ada refresh token? Kalau tidak ada, harus reconnect manual */
  hasRefreshToken: boolean;
  /** Sedang refresh? */
  refreshing: boolean;
  /** Klik REFRESH */
  onRefresh: () => void;
  /** Klik DISMISS / X */
  onDismiss: () => void;
  /** Kalau true, tampilkan bunyi */
  soundEnabled?: boolean;
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
  } catch {
    /* ignore */
  }
}

export const ReminderPopup = ({
  minutesUntilExpiry,
  hasRefreshToken,
  refreshing,
  onRefresh,
  onDismiss,
  soundEnabled = true,
}: Props) => {
  const playedRef = useRef(false);

  useEffect(() => {
    if (playedRef.current) return;
    playedRef.current = true;
    if (soundEnabled) {
      playBeep();
    }
  }, [soundEnabled]);

  const expired = minutesUntilExpiry <= 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        maxWidth: 420,
        background: 'rgba(20, 20, 20, 0.95)',
        border: '2px solid #ef3f25',
        borderRadius: 6,
        padding: 16,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        color: '#fff',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <AlertCircle size={22} color="#ef3f25" style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, letterSpacing: '.05em' }}>
            {expired ? 'GOOGLE DRIVE TOKEN EXPIRED' : 'GOOGLE DRIVE TOKEN EXPIRING'}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.75)', marginBottom: 12 }}>
            {expired
              ? 'Token sudah habis. Upload ke Drive berhenti. Klik REFRESH NOW untuk login ulang.'
              : `Token akan habis dalam ${minutesUntilExpiry} menit. Klik REFRESH NOW untuk memperbarui.`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              style={{
                flex: 1,
                padding: '8px 14px',
                background: refreshing ? '#555' : '#ef3f25',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
                fontSize: 13,
                cursor: refreshing ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <RefreshCw size={14} />
              {refreshing ? 'REFRESHING...' : 'REFRESH NOW'}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              style={{
                padding: '8px 12px',
                background: 'transparent',
                color: 'rgba(255,255,255,.6)',
                border: '1px solid rgba(255,255,255,.2)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              LATER
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,.5)',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
};