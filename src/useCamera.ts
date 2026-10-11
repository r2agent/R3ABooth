import { useCallback, useEffect, useRef, useState } from 'react';
import { getEffectiveResolution, getFrameRateConstraint, getPreviewQualityConstraint, type CameraSettings } from './cameraStore';

export type CameraStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type CameraError = 'permission-denied' | 'not-found' | 'in-use' | 'unknown';

export function useCamera(settings: CameraSettings | null, enabled: boolean) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<CameraError | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  const settingsRef = useRef(settings);
  const isRestartingRef = useRef(false);

  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  /* Paksa stop semua track lama */
  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        try { t.stop(); } catch { /* ignore */ }
      });
      streamRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    stopTracks();
    setStream(null);
    setStatus('idle');
    setError(null);
  }, [stopTracks]);

  /* Start tunggal — SELALU force-release stream lama dulu */
  const start = useCallback(async (): Promise<boolean> => {
    const s = settingsRef.current;
    if (!s || !s.cameraOn) {
      setStatus('disconnected');
      return false;
    }

    // ⚠️ Force stop old stream dulu — ini kunci recovery
    stopTracks();
    setStream(null);
    setStatus('connecting');
    setError(null);

    try {
      const { width, height } = getEffectiveResolution(s);
      const fps = getFrameRateConstraint(s.frameRate);
      const previewConstraint = getPreviewQualityConstraint(s.previewQuality);

      const idealWidth = previewConstraint?.width ?? width;
      const idealHeight = previewConstraint?.height ?? height;

      const constraints: MediaStreamConstraints = {
        video: s.selectedDeviceId
          ? { deviceId: { exact: s.selectedDeviceId }, width: { ideal: idealWidth }, height: { ideal: idealHeight }, frameRate: { ideal: fps } }
          : { width: { ideal: idealWidth }, height: { ideal: idealHeight }, frameRate: { ideal: fps } },
        audio: false,
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = newStream;
      setStream(newStream);
      setStatus('connected');
      return true;
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') setError('permission-denied');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') setError('not-found');
      else if (name === 'NotReadableError') setError('in-use');
      else setError('unknown');
      setStatus('error');
      return false;
    }
  }, [stopTracks]);

  /* ============================================================
     FORCE RESTART — stop + retry up to 5x dengan backoff
     Dipakai untuk recovery setelah OAuth popup / device suspend
     ============================================================ */
  const forceRestart = useCallback(async () => {
    if (isRestartingRef.current) return;
    isRestartingRef.current = true;
    try {
      stopTracks();
      setStream(null);
      setStatus('connecting');
      setError(null);

      for (let attempt = 0; attempt < 5; attempt++) {
        const ok = await start();
        if (ok) {
          isRestartingRef.current = false;
          return;
        }
        // Backoff: 500, 900, 1300, 1700, 2100 ms
        const delay = 500 + attempt * 400;
        await new Promise((r) => setTimeout(r, delay));
      }
    } finally {
      isRestartingRef.current = false;
    }
  }, [start, stopTracks]);

  /* Initial mount + enabled toggling */
  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }
    void start();
    return () => { stop(); };
  }, [enabled, start, stop]);

  /* Track ended/mute handlers */
  useEffect(() => {
    if (!enabled || !stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const scheduleRestart = () => {
      if (!enabledRef.current) return;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (enabledRef.current && settingsRef.current?.cameraOn) {
          void forceRestart();
        }
      }, 1000);
    };

    const onEnded = () => {
      setStatus('disconnected');
      scheduleRestart();
    };
    const onUnmute = () => { setStatus('connected'); };
    const onMute = () => {
      setStatus('disconnected');
      // ⚠️ Mute juga trigger restart — kalau browser ambil kamera (OAuth popup)
      scheduleRestart();
    };

    track.addEventListener('ended', onEnded);
    track.addEventListener('unmute', onUnmute);
    track.addEventListener('mute', onMute);
    return () => {
      track.removeEventListener('ended', onEnded);
      track.removeEventListener('unmute', onUnmute);
      track.removeEventListener('mute', onMute);
    };
  }, [stream, enabled, forceRestart]);

  /* Device change */
  useEffect(() => {
    if (!enabled) return;
    const handler = async () => {
      if (isRestartingRef.current) return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') {
        await forceRestart();
      }
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', handler);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handler);
  }, [enabled, forceRestart]);

  /* ============================================================
     VISIBILITY + FOCUS — setelah OAuth popup close, tab kembali
     visible/focus → cek track, kalau bad → force restart
     ============================================================ */
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      // Delay biar browser settle dulu (popup close animation, dll)
      setTimeout(() => {
        const track = streamRef.current?.getVideoTracks()[0];
        const isBad = !track || track.readyState === 'ended' || track.muted;
        if (isBad) {
          void forceRestart();
        }
      }, 600);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [enabled, forceRestart]);

  return { stream, status, error, start, stop, forceRestart };
}