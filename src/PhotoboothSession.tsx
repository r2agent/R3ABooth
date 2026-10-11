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

  /* ---------- STOP TRACKS (no state) ---------- */
  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        try { t.stop(); } catch { /* ignore */ }
      });
      streamRef.current = null;
    }
  }, []);

  /* ---------- STOP ---------- */
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

  /* ---------- START ---------- */
  const start = useCallback(async (): Promise<boolean> => {
    const s = settingsRef.current;
    if (!s || !s.cameraOn) {
      setStatus('disconnected');
      return false;
    }

    // ⚠️ Force-stop lama + tunggu OS release handle (300ms)
    if (streamRef.current) {
      stopTracks();
      setStream(null);
      await new Promise((r) => setTimeout(r, 300));
    }

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

  /* ---------- FORCE RESTART (retry backoff) ---------- */
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
        const delay = 500 + attempt * 400; // 500, 900, 1300, 1700, 2100
        await new Promise((r) => setTimeout(r, delay));
      }
    } finally {
      isRestartingRef.current = false;
    }
  }, [start, stopTracks]);

  /* ---------- INITIAL MOUNT ---------- */
  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }
    void start();
    return () => { stop(); };
  }, [enabled, start, stop]);

  /* ---------- TRACK HEALTH HANDLERS ---------- */
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
      }, 800);
    };

    const onEnded = () => { setStatus('disconnected'); scheduleRestart(); };
    const onMute = () => { setStatus('disconnected'); scheduleRestart(); };
    const onUnmute = () => { setStatus('connected'); };

    track.addEventListener('ended', onEnded);
    track.addEventListener('mute', onMute);
    track.addEventListener('unmute', onUnmute);
    return () => {
      track.removeEventListener('ended', onEnded);
      track.removeEventListener('mute', onMute);
      track.removeEventListener('unmute', onUnmute);
    };
  }, [stream, enabled, forceRestart]);

  /* ============================================================
     HEALTH MONITOR — cek tiap 2s, restart kalau track bad
     Ini yang bikin kamera "always on" selama event
     ============================================================ */
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (isRestartingRef.current) return;
      if (!enabledRef.current || !settingsRef.current?.cameraOn) return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) {
        // Stream hilang — restart
        if (!isRestartingRef.current) void forceRestart();
        return;
      }
      if (track.readyState === 'ended' || track.muted) {
        if (!isRestartingRef.current) void forceRestart();
      }
    }, 2000);
    return () => clearInterval(id);
  }, [enabled, forceRestart]);

  /* ---------- VISIBILITY + FOCUS ---------- */
  useEffect(() => {
    if (!enabled) return;
    const onWake = () => {
      if (document.visibilityState !== 'visible') return;
      setTimeout(() => {
        if (isRestartingRef.current) return;
        const track = streamRef.current?.getVideoTracks()[0];
        const isBad = !track || track.readyState === 'ended' || track.muted;
        if (isBad) void forceRestart();
      }, 700);
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [enabled, forceRestart]);

  /* ---------- DEVICE CHANGE ---------- */
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

  return { stream, status, error, start, stop, forceRestart };
}
