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

  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const stop = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
    }
    setStatus('idle');
    setError(null);
  }, []);

  const start = useCallback(async () => {
    const s = settingsRef.current;
    if (!s || !s.cameraOn) {
      setStatus('disconnected');
      return;
    }
    setStatus('connecting');
    setError(null);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
    }

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
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') setError('permission-denied');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') setError('not-found');
      else if (name === 'NotReadableError') setError('in-use');
      else setError('unknown');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }
    void start();
    return () => { stop(); };
  }, [enabled, start, stop]);

  useEffect(() => {
    if (!enabled || !stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const scheduleRestart = () => {
      if (!enabledRef.current) return;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      // Delay 800ms supaya OAuth popup / device suspend selesai dulu
      restartTimerRef.current = setTimeout(() => {
        if (enabledRef.current && settingsRef.current?.cameraOn) {
          void start();
        }
      }, 800);
    };

    const onEnded = () => {
      setStatus('disconnected');
      scheduleRestart();
    };
    const onUnmute = () => { setStatus('connected'); };
    const onMute = () => { setStatus('disconnected'); };

    track.addEventListener('ended', onEnded);
    track.addEventListener('unmute', onUnmute);
    track.addEventListener('mute', onMute);
    return () => {
      track.removeEventListener('ended', onEnded);
      track.removeEventListener('unmute', onUnmute);
      track.removeEventListener('mute', onMute);
    };
  }, [stream, enabled, start]);

  useEffect(() => {
    if (!enabled) return;
    const handler = async () => {
      if (streamRef.current) {
        const track = streamRef.current.getVideoTracks()[0];
        if (!track || track.readyState === 'ended') {
          setStatus('disconnected');
          await start();
        }
      } else if (settingsRef.current?.cameraOn) {
        await start();
      }
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', handler);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handler);
  }, [enabled, start]);

  // ⚠️ Auto-restart saat device kembali visible (setelah OAuth popup close, minimize, dll)
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        const track = streamRef.current?.getVideoTracks()[0];
        if (!track || track.readyState === 'ended') {
          void start();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, start]);

  return { stream, status, error, start, stop };
}