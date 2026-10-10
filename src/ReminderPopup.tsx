import { useEffect, useRef } from 'react';
import { AlertCircle, RefreshCw, X, Maximize2 } from 'lucide-react';

type Props = {
  minutesUntilExpiry: number;
  hasRefreshToken: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onDismiss: () => void;
  soundEnabled?: boolean;
  /** Setelah OAuth sukses: popup minta operator klik FULLSCREEN NOW */
  needsFullscreen?: boolean;
  /** Klik FULLSCREEN NOW */
  onGoFullscreen?: () => void;
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
  needsFullscreen = false,
  onGoFullscreen,
}: Props) => {
  const playedRef = useRef(false);

  useEffect(() => {
    if (playedRef.current) return;
    playedRef.current = true;
    if (soundEnabled && !needsFullscreen) {
      playBeep();
    }
  }, [soundEnabled, needsFullscreen]);

  const expired = minutesUntilExpiry <= 0;

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
      onClick={needsFullscreen ? undefined : onDismiss}
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
        {!needsFullscreen ? (
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
        ) : null}

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          {needsFullscreen
            ? <Maximize2 size={36} color="#4ade80" style={{ flexShrink: 0, marginTop: 2 }} />
            : <AlertCircle size={36} color="#ef3f25" style={{ flexShrink: 0, marginTop: 2 }} />}

          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8, letterSpacing: '.05em' }}>
              {needsFullscreen
                ? 'TOKEN REFRESHED'
                : expired
                  ? 'GOOGLE DRIVE TOKEN EXPIRED'
                  : 'GOOGLE DRIVE TOKEN EXPIRING'}
            </div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,.75)', marginBottom: 20, lineHeight: 1.5 }}>
              {needsFullscreen
                ? 'Token berhasil diperbarui. Klik FULLSCREEN NOW untuk kembali ke mode booth (layar penuh).'
                : expired
                  ? 'Token sudah habis. Upload ke Drive berhenti. Klik REFRESH NOW untuk login ulang.'
                  : `Token akan habis dalam ${minutesUntilExpiry} menit. Klik REFRESH NOW untuk memperbarui.`}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              {needsFullscreen ? (
                <button
                  type="button"
                  onClick={onGoFullscreen}
                  style={{
                    flex: 1,
                    padding: '12px 18px',
                    background: '#4ade80',
                    color: '#000',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <Maximize2 size={16} />
                  FULLSCREEN NOW
                </button>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};