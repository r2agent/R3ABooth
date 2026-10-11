/* ============================================================
   EVENT LOADER — load event dari URL slug (Firebase)
   ============================================================ */
import { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { loadEventFromCloud, type CloudEvent } from './cloudEventSync';

export const EventLoader = ({
  slug,
  onLoad,
  onNotFound,
}: {
  slug: string;
  onLoad: (event: CloudEvent) => void;
  onNotFound: () => void;
}) => {
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setStatus('loading');
        const event = await loadEventFromCloud(slug);
        if (cancelled) return;

        if (!event) {
          onNotFound();
          return;
        }
        onLoad(event);
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(e instanceof Error ? e.message : 'Gagal load event');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, onLoad, onNotFound]);

  if (status === 'error') {
    return (
      <main
        className="photobooth-screen photobooth-kiosk"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
        }}
      >
        <AlertCircle size={48} strokeWidth={1} />
        <h2 style={{ fontSize: 24, margin: 0 }}>Gagal Load Event</h2>
        <p
          style={{
            color: 'rgba(255,255,255,.5)',
            margin: 0,
            textAlign: 'center',
            maxWidth: 400,
          }}
        >
          {errorMsg}
        </p>
        <button
          onClick={onNotFound}
          type="button"
          style={{
            marginTop: 8,
            padding: '10px 24px',
            background: '#ef3f25',
            color: '#fff',
            border: 'none',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          KEMBALI KE HOME
        </button>
      </main>
    );
  }

  return (
    <main
      className="photobooth-screen photobooth-kiosk"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}
    >
      <Loader2
        size={48}
        strokeWidth={1}
        style={{ animation: 'spin 1s linear infinite' }}
      />
      <span
        style={{
          color: 'rgba(255,255,255,.5)',
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: '.1em',
        }}
      >
        LOADING EVENT...
      </span>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </main>
  );
};