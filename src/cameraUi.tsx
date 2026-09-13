import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Camera, CheckCircle2, VideoOff, X } from 'lucide-react';
import { useCamera } from './useCamera';
import { getAspectRatioValue, type CameraSettings } from './cameraStore';

export const CameraPreview = ({ stream, mirror, className, aspectRatio }: { stream: MediaStream | null; mirror: boolean; className?: string; aspectRatio?: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ar = aspectRatio ? getAspectRatioValue(aspectRatio) : 16 / 9;
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => {});
    }
  }, [stream]);
  return <video ref={videoRef} autoPlay playsInline muted className={className} style={{ transform: mirror ? 'scaleX(-1)' : 'none', aspectRatio: String(ar) }} />;
};

export const CameraStatusBadge = ({ status, error }: { status: string; error: string | null }) => {
  if (status === 'connected') return <span className="camera-status-badge connected"><CheckCircle2 size={14} /> CONNECTED</span>;
  if (status === 'connecting') return <span className="camera-status-badge connecting">CONNECTING...</span>;
  if (status === 'error') return <span className="camera-status-badge error"><AlertCircle size={14} /> {error === 'permission-denied' ? 'PERMISSION DENIED' : error === 'not-found' ? 'CAMERA NOT FOUND' : error === 'in-use' ? 'CAMERA IN USE' : 'CAMERA ERROR'}</span>;
  return <span className="camera-status-badge disconnected"><VideoOff size={14} /> DISCONNECTED</span>;
};

export const errorMessages: Record<string, string> = {
  'permission-denied': 'Camera permission was denied. Please allow camera access in your browser or system settings.',
  'not-found': 'No camera device was found. Connect a camera and try again.',
  'in-use': 'The camera is already in use by another application. Close it and try again.',
  'unknown': 'An unexpected camera error occurred. Try restarting the application.',
};

type TestResult = { label: string; value: string; ok: boolean } | null;

export const CameraTestModal = ({ settings, onClose }: { settings: CameraSettings; onClose: () => void }) => {
  const { stream, status, error, stop } = useCamera(settings, true);
  const [testResult, setTestResult] = useState<TestResult>(null);

  useEffect(() => {
    if (status === 'connected' && stream && !testResult) {
      const track = stream.getVideoTracks()[0];
      const settings2 = track?.getSettings();
      setTestResult({
        label: 'Device',
        value: track?.label || settings.selectedDeviceId || 'Default Camera',
        ok: true,
      });
      void settings2;
    }
    if (status === 'error' && !testResult) {
      setTestResult({
        label: 'Error',
        value: error ? errorMessages[error] : 'Unknown error',
        ok: false,
      });
    }
  }, [status, stream, error, testResult, settings.selectedDeviceId]);

  useEffect(() => () => { stop(); }, [stop]);

  return (
    <div className="camera-test-overlay" onClick={onClose}>
      <div className="camera-test-modal" onClick={(e) => e.stopPropagation()}>
        <div className="camera-test-header">
          <span>TEST CAMERA</span>
          <button onClick={onClose} type="button"><X size={20} /></button>
        </div>
        <div className="camera-test-body">
          {stream ? (
            <CameraPreview stream={stream} mirror={settings.mirror} aspectRatio={settings.aspectRatio} className="camera-test-video" />
          ) : (
            <div className="camera-test-placeholder">
              {status === 'error' ? <AlertCircle size={40} /> : <Camera size={40} />}
              <span>{status === 'error' ? (error ? errorMessages[error] : 'Camera error') : status === 'connecting' ? 'Connecting...' : 'No camera'}</span>
            </div>
          )}
        </div>
        <div className="camera-test-footer">
          <CameraStatusBadge status={status} error={error} />
          <button onClick={onClose} type="button">CLOSE TEST</button>
        </div>
      </div>
    </div>
  );
};
