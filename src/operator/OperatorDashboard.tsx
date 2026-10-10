import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, X, AlertCircle, CheckCircle2, Clock, Plug } from 'lucide-react';
import {
  getAllPendingUploads,
  getUploadStats,
  retryAllPending,
  type PendingUpload,
} from '../uploadService';
import { getTokenStatus, connectGoogleDrive, type TokenStatus } from '../gdriveService';
import type { AllSettings } from '../settingsStore';

const REFRESH_INTERVAL_MS = 3000;

export const OperatorDashboard = ({
  allSettings,
  onClose,
}: {
  allSettings: AllSettings;
  onClose: () => void;
}) => {
  const [stats, setStats] = useState({ uploaded: 0, pending: 0, failed: 0 });
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [token, setToken] = useState<TokenStatus>({
    hasToken: false,
    expiresAt: null,
    expiresInMs: null,
    account: null,
    hasRefreshToken: false,
  });
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [retrying, setRetrying] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, p, t] = await Promise.all([
        getUploadStats().catch(() => ({ uploaded: 0, pending: 0, failed: 0 })),
        getAllPendingUploads().catch(() => []),
        getTokenStatus().catch(() => ({
          hasToken: false,
          expiresAt: null,
          expiresInMs: null,
          account: null,
          hasRefreshToken: false,
        })),
      ]);
      setStats(s);
      setPending(p);
      setToken(t);
      setLastUpdate(new Date());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!actionMessage) return;
    const t = setTimeout(() => setActionMessage(null), 4000);
    return () => clearTimeout(t);
  }, [actionMessage]);

  const handleRetryAll = useCallback(async () => {
    const clientId = allSettings.googleDrive.clientId;
    if (!clientId) {
      setActionMessage('No Client ID configured.');
      return;
    }
    if (pending.length === 0) {
      setActionMessage('No pending uploads.');
      return;
    }
    setRetrying(true);
    try {
      const succeeded = await retryAllPending(clientId);
      await refresh();
      setActionMessage(`Retried: ${succeeded} file(s) uploaded successfully.`);
    } catch {
      setActionMessage('Retry failed. Check connection.');
    } finally {
      setRetrying(false);
    }
  }, [allSettings.googleDrive.clientId, pending.length, refresh]);

  const handleReconnect = useCallback(async () => {
    const clientId = allSettings.googleDrive.clientId;
    if (!clientId) {
      setActionMessage('No Client ID configured.');
      return;
    }
    setReconnecting(true);
    try {
      const result = await connectGoogleDrive(clientId);
      await refresh();
      if (result.success) {
        setActionMessage(`Reconnected as ${result.account || 'unknown account'}.`);
      } else {
        setActionMessage(`Reconnect failed: ${result.error || 'unknown error'}`);
      }
    } catch {
      setActionMessage('Reconnect failed.');
    } finally {
      setReconnecting(false);
    }
  }, [allSettings.googleDrive.clientId, refresh]);

  const tokenExpiresIn = token.expiresInMs
    ? Math.max(0, Math.floor(token.expiresInMs / 60000))
    : 0;

  return (
    <main
      className="photobooth-screen photobooth-kiosk"
      style={{ padding: 24, overflow: 'auto', minHeight: '100vh' }}
    >
      <div className="photobooth-kiosk-header">
        <div className="photobooth-project">
          <span>R3A BOOTH</span>
          <strong>OPERATOR DASHBOARD</strong>
        </div>
        <button className="photobooth-exit" onClick={onClose} type="button">
          <X size={24} /> CLOSE
        </button>
      </div>

      <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 13, margin: '0 0 16px' }}>
        Last update: {lastUpdate.toLocaleTimeString()}
      </p>

      {actionMessage ? (
        <div
          style={{
            padding: '10px 14px',
            background: 'rgba(239,63,37,.15)',
            border: '1px solid rgba(239,63,37,.4)',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {actionMessage}
        </div>
      ) : null}

      <section style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, letterSpacing: '.1em' }}>
            DRIVE STATUS
          </h3>
          <p style={{ margin: 4, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            {token.hasToken ? (
              <>
                <CheckCircle2 size={14} color="#4ade80" /> Connected
              </>
            ) : token.hasRefreshToken ? (
              <>
                <AlertCircle size={14} color="#facc15" /> Token expired — auto-refresh available
              </>
            ) : (
              <>
                <AlertCircle size={14} color="#ef4444" /> Not connected
              </>
            )}
          </p>
          <p style={{ margin: 4, fontSize: 13, color: 'rgba(255,255,255,.6)' }}>
            Account: {token.account || '—'}
          </p>
          <p style={{ margin: 4, fontSize: 13, color: 'rgba(255,255,255,.6)' }}>
            Token expires in: {token.hasToken ? `${tokenExpiresIn} min` : '—'}
          </p>
          <p style={{ margin: 4, fontSize: 12, color: 'rgba(255,255,255,.4)' }}>
            Refresh token: {token.hasRefreshToken ? '✓ stored' : '✗ not stored'}
          </p>
        </div>

        <div style={{ border: '1px solid rgba(255,255,255,.1)', padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, letterSpacing: '.1em' }}>
            UPLOAD STATUS
          </h3>
          <p style={{ margin: 4, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <CheckCircle2 size={14} color="#4ade80" /> Uploaded: {stats.uploaded}
          </p>
          <p style={{ margin: 4, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={14} color="#facc15" /> Pending: {stats.pending}
          </p>
        </div>
      </section>

      <section style={{ marginTop: 16, border: '1px solid rgba(255,255,255,.1)', padding: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, letterSpacing: '.1em' }}>
          PENDING LIST ({pending.length})
        </h3>
        {pending.length === 0 ? (
          <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 13, margin: 0 }}>
            No pending uploads. All good.
          </p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              maxHeight: 240,
              overflow: 'auto',
            }}
          >
            {pending.slice(0, 50).map((p) => (
              <li
                key={p.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: '1px solid rgba(255,255,255,.05)',
                  fontSize: 13,
                }}
              >
                <span>{p.fileName}</span>
                <span style={{ color: 'rgba(255,255,255,.5)' }}>
                  {new Date(p.createdAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
        <button
          onClick={handleRetryAll}
          disabled={retrying || pending.length === 0}
          type="button"
          style={{
            padding: '10px 20px',
            background: pending.length === 0 ? '#555' : '#ef3f25',
            color: '#fff',
            border: 'none',
            fontWeight: 600,
            cursor: retrying || pending.length === 0 ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <RefreshCw size={16} /> {retrying ? 'RETRYING...' : 'RETRY ALL'}
        </button>
        <button
          onClick={handleReconnect}
          disabled={reconnecting}
          type="button"
          style={{
            padding: '10px 20px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            fontWeight: 600,
            cursor: reconnecting ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Plug size={16} /> {reconnecting ? 'CONNECTING...' : 'RE-CONNECT DRIVE'}
        </button>
      </div>
    </main>
  );
};