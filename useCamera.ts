import { useCallback, useEffect, useRef, useState } from 'react';
import { getEffectiveResolution, getFrameRateConstraint, getPreviewQualityConstraint, type CameraSettings } from './cameraStore';

export type CameraStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type CameraError = 'permission-denied' | 'not-found' | 'in-use' | 'unknown';

export function useCamera(settings: CameraSettings | null, enabled: boolean) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<CameraError | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
    }
    setStatus('idle');
    setError(null);
  }, []);

  const start = useCallback(async () => {
    if (!settings || !settings.cameraOn) {
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
      const { width, height } = getEffectiveResolution(settings);
      const fps = getFrameRateConstraint(settings.frameRate);
      const previewConstraint = getPreviewQualityConstraint(settings.previewQuality);

      const idealWidth = previewConstraint?.width ?? width;
      const idealHeight = previewConstraint?.height ?? height;

      const constraints: MediaStreamConstraints = {
        video: settings.selectedDeviceId
          ? { deviceId: { exact: settings.selectedDeviceId }, width: { ideal: idealWidth }, height: { ideal: idealHeight }, frameRate: { ideal: fps } }
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
  }, [settings]);

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
    const onEnded = () => { setStatus('disconnected'); };
    const onUnmute = () => { setStatus('connected'); };
    track.addEventListener('ended', onEnded);
    track.addEventListener('unmute', onUnmute);
    return () => {
      track.removeEventListener('ended', onEnded);
      track.removeEventListener('unmute', onUnmute);
    };
  }, [stream, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const handler = async () => {
      if (streamRef.current) {
        const track = streamRef.current.getVideoTracks()[0];
        if (!track || track.readyState === 'ended') {
          setStatus('disconnected');
          await start();
        }
      } else if (settings?.cameraOn) {
        await start();
      }
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', handler);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handler);
  }, [enabled, start, stream, settings?.cameraOn]);

  return { stream, status, error, start, stop };
}
