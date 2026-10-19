import { QRISGate } from './QRISGate';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, X, AlertCircle, RotateCcw, Check, Filter as FilterIcon, Image as ImageIcon, ChevronLeft, QrCode, Printer, RefreshCw, Maximize2, Key, Eye } from 'lucide-react';
import { useCamera } from './useCamera';
import { CameraPreview, CameraStatusBadge, errorMessages } from './cameraUi';
import { getAspectRatioValue } from './cameraStore';
import { FILTERS, getFilterCss, isGlowFilter, applyGlowToCanvas } from './filters';
import { saveCapture, saveResult, type StoredCapture, type StoredResult } from './storage';
import { generateQrCode, buildResultPayload, buildDriveResultPayload } from './qrService';
import { printResult } from './printService';
import { getOrCreateNextGuestFolder, type GuestRecord } from './guestStore';
import { autoUploadToGuestFolder, retryFailedUploads, getUploadStats, type UploadFileEntry } from './uploadService';
import { buildDriveFolderUrl, getTokenStatus, connectGoogleDrive } from './gdriveService';
import { recordSession, getTodayStats, resetAppUptime, clearAllStats } from './sessionStats';
import { downloadLogs } from './deviceDiagnostic';
import {
  writeStatus,
  markOfflineOnDisconnect,
  clearStatus,
  getDeviceId,
  subscribeCommands,
  clearCommand,
  getDriveQuota,
  setDeviceName,
} from './statusSync';
import type { CameraSettings } from './cameraStore';
import type { Frame, R3aEvent, Slot } from './eventStore';
import type { AllSettings } from './settingsStore';
import { IGFollowGate } from './IGFollowGate';
import { loadAppVersion } from './versionStore';
import { saveFileFromDataUrl } from './fileSaver';

const igGateImage = '/ig-gate.jpg';

const VITE_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '';

const RESTART_CAMERA_EVENT = 'r3a:restart-camera';

type SessionPhase = 'frame-select' | 'ready' | 'live' | 'countdown' | 'filter' | 'compositing' | 'result' | 'qr' | 'drive-qr';

type CaptureError = { message: string } | null;

type CaptureData = {
  captureId: string;
  dataUrl: string;
};

function getUniqueCaptureIds(slots: Slot[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const s of slots) {
    if (!seen.has(s.captureId)) { seen.add(s.captureId); ids.push(s.captureId); }
  }
  return ids;
}

function captureFromVideo(video: HTMLVideoElement, mirror: boolean): string {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1920;
  canvas.height = video.videoHeight || 1080;
  const ctx = canvas.getContext('2d')!;
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.92);
}

function pickVideoMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/mp4;codecs=h264',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function guessVideoExtension(dataUrl: string): string {
  const match = dataUrl.match(/^data:video\/([a-zA-Z0-9]+)/);
  if (!match) return 'webm';
  return match[1].includes('mp4') ? 'mp4' : 'webm';
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for video'));
    img.src = src;
  });
}

function generateFileName(extension: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${date}_${time}_${rand}.${extension}`;
}

async function generateSlideshowVideo(
  photos: { dataUrl: string }[],
  durationPerPhotoMs: number,
): Promise<string | null> {
  if (photos.length === 0) return null;
  const mimeType = pickVideoMimeType();
  type CaptureCanvas = HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream };
  const canvas = document.createElement('canvas') as CaptureCanvas;
  if (!mimeType || typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
    return null;
  }

  let images: HTMLImageElement[];
  try {
    images = await Promise.all(photos.map((p) => loadImageEl(p.dataUrl)));
  } catch {
    return null;
  }

  const width = images[0].naturalWidth || 1280;
  const height = images[0].naturalHeight || 720;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const stream = canvas.captureStream(30);

  return new Promise<string | null>((resolve) => {
    const chunks: Blob[] = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 16_000_000,
      });
    } catch {
      resolve(null);
      return;
    }
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    };

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(images[0], 0, 0, width, height);
    recorder.start();

    setTimeout(() => {
      let i = 1;
      const drawNext = () => {
        if (i < images.length) {
          ctx.clearRect(0, 0, width, height);
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(images[i], 0, 0, width, height);
          i++;
          setTimeout(drawNext, durationPerPhotoMs);
        } else {
          setTimeout(() => recorder.stop(), 400);
        }
      };
      drawNext();
    }, 500);
  });
}

function drawPhotoCovered(ctx: CanvasRenderingContext2D, photo: HTMLImageElement, sx: number, sy: number, sw: number, sh: number): void {
  const scale = Math.max(sw / photo.naturalWidth, sh / photo.naturalHeight);
  const dw = photo.naturalWidth * scale;
  const dh = photo.naturalHeight * scale;
  const dx = sx + (sw - dw) / 2;
  const dy = sy + (sh - dh) / 2;
  ctx.drawImage(photo, dx, dy, dw, dh);
}

async function compositeFrame(frame: Frame, captures: Map<string, string>, captureFilters: Map<string, string>, isReceiptMode: boolean = false): Promise<string> {
  const frameImg = frame.image ? await loadImage(frame.image) : null;
  const fw = frameImg?.naturalWidth || 1800;
  const fh = frameImg?.naturalHeight || 1200;
  const canvas = document.createElement('canvas');
  canvas.width = fw;
  canvas.height = fh;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#2a2522';
  ctx.fillRect(0, 0, fw, fh);

  if (isReceiptMode && frameImg) {
    ctx.drawImage(frameImg, 0, 0, fw, fh);
  }

  const scale = frame.photoScale ?? 1;
  const rotation = ((frame.photoRotation ?? 0) * Math.PI) / 180;

  for (const slot of frame.slots) {
    const cap = captures.get(slot.captureId);
    if (!cap) continue;
    try {
      const photo = await loadImage(cap);
      const sx = (slot.x / 100) * fw;
      const sy = (slot.y / 100) * fh;
      const sw = (slot.w / 100) * fw;
      const sh = (slot.h / 100) * fh;

      const offsetX = ((frame.photoOffsetX ?? 0) / 100) * sw;
      const offsetY = ((frame.photoOffsetY ?? 0) / 100) * sh;

      const filterId = captureFilters.get(slot.captureId) || 'natural';
      const glow = isGlowFilter(filterId);
      const baseCss = glow ? 'brightness(1.08) saturate(1.15)' : getFilterCss(filterId);

      const photoAspect = photo.naturalWidth / photo.naturalHeight;
      const slotAspect = sw / sh;
      let drawW: number, drawH: number;
      if (photoAspect > slotAspect) {
        drawH = sh;
        drawW = sh * photoAspect;
      } else {
        drawW = sw;
        drawH = sw / photoAspect;
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, sy, sw, sh);
      ctx.clip();
      ctx.translate(sx + sw / 2 + offsetX, sy + sh / 2 + offsetY);
      ctx.rotate(rotation);
      ctx.scale(scale, scale);
      ctx.filter = baseCss;
      ctx.drawImage(photo, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.filter = 'none';
      if (glow) applyGlowToCanvas(ctx, photo, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    } catch { /* skip failed slot */ }
  }

  if (!isReceiptMode && frameImg) {
    ctx.drawImage(frameImg, 0, 0, fw, fh);
  }

  return canvas.toDataURL('image/jpeg', 0.95);
}

async function generateSlotPhoto(slot: Slot, captureDataUrl: string, filterId: string, frame: Frame, isReceiptMode: boolean = false): Promise<string> {
  void slot;
  const CANVAS_W = 1920;
  const CANVAS_H = 1080;

  const photo = await loadImage(captureDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d')!;

  const scale = frame.photoScale ?? 1;
  const rotation = ((frame.photoRotation ?? 0) * Math.PI) / 180;
  const offsetX = ((frame.photoOffsetX ?? 0) / 100) * CANVAS_W;
  const offsetY = ((frame.photoOffsetY ?? 0) / 100) * CANVAS_H;

  const effectiveFilterId = isReceiptMode ? 'grayscale' : filterId;

  const glow = isGlowFilter(effectiveFilterId);
  const baseCss = glow ? 'brightness(1.08) saturate(1.15)' : getFilterCss(effectiveFilterId);

  const photoAspect = photo.naturalWidth / photo.naturalHeight;
  const canvasAspect = CANVAS_W / CANVAS_H;
  let drawW: number, drawH: number;
  if (photoAspect > canvasAspect) {
    drawH = CANVAS_H;
    drawW = CANVAS_H * photoAspect;
  } else {
    drawW = CANVAS_W;
    drawH = CANVAS_W / photoAspect;
  }

  ctx.save();
  ctx.translate(CANVAS_W / 2 + offsetX, CANVAS_H / 2 + offsetY);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.filter = baseCss;
  ctx.drawImage(photo, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.filter = 'none';
  if (glow) applyGlowToCanvas(ctx, photo, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  if (frame.slotFrameImage) {
    try {
      const overlay = await loadImage(frame.slotFrameImage);
      ctx.drawImage(overlay, 0, 0, CANVAS_W, CANVAS_H);
    } catch { /* skip */ }
  }

  return canvas.toDataURL('image/jpeg', 0.95);
}

function downloadDataUrl(dataUrl: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export const PhotoboothSession = ({
  event,
  cameraSettings,
  allSettings,
  onExit,
  onPhaseChange,
}: {
  event: R3aEvent;
  cameraSettings: CameraSettings;
  allSettings: AllSettings;
  onExit: () => void;
  onPhaseChange?: (phase: string) => void;
}) => {
  const { stream, status, error, forceRestart } = useCamera(cameraSettings, true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameGridRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const sessionStartedAtRef = useRef<number | null>(null);
  const isPushingRef = useRef(false);
  const eventOpenedAtRef = useRef<number>(Date.now());
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const [phase, setPhase] = useState<SessionPhase>('frame-select');
  const [countdown, setCountdown] = useState(0);
  const [captures, setCaptures] = useState<CaptureData[]>([]);
  const [currentCaptureIndex, setCurrentCaptureIndex] = useState(0);
  const [captureFilters, setCaptureFilters] = useState<Map<string, string>>(new Map());
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [compositeUrl, setCompositeUrl] = useState<string | null>(null);
  const [compositeColorUrl, setCompositeColorUrl] = useState<string | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string>('');
  const [printing, setPrinting] = useState(false);
  const [printed, setPrinted] = useState(false);
  const [showAdminExit, setShowAdminExit] = useState(false);
  const [screensaverActive, setScreensaverActive] = useState(false);
  const [pendingFullscreen, setPendingFullscreen] = useState(false);
  const [pendingRefreshToken, setPendingRefreshToken] = useState(false);
  const [capturePreviewUrl, setCapturePreviewUrl] = useState<string | null>(null);
  const [currentGuest, setCurrentGuest] = useState<GuestRecord | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestAssigning, setGuestAssigning] = useState(false);
  const logoClickCount = useRef(0);
  const logoClickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [captureError, setCaptureError] = useState<CaptureError>(null);
  const [qrError, setQrError] = useState(false);
  const [driveQrDataUrl, setDriveQrDataUrl] = useState<string | null>(null);
  const [driveQrError, setDriveQrError] = useState(false);
  const [frameAspect, setFrameAspect] = useState(3 / 2);
  const [framesReady, setFramesReady] = useState(false);
  const [showIGGate, setShowIGGate] = useState(false);
  const [qrHistory, setQrHistory] = useState<{ id: string; url: string; type: string; time: number }[]>([]);
  const [pendingFrameIndex, setPendingFrameIndex] = useState<number | null>(null);
  const [idleWarning, setIdleWarning] = useState(0);
  const [showQRISGate, setShowQRISGate] = useState(false);

  const version = loadAppVersion();
  const isReceiptMode = version === 'v2.1.0';

  useEffect(() => {
    if (phase !== 'ready' && phase !== 'live') return;
    if (status === 'connected' || status === 'connecting') return;
    const t = setTimeout(() => { void forceRestart(); }, 200);
    return () => clearTimeout(t);
  }, [phase, status, forceRestart]);

  useEffect(() => {
    const handler = () => {
      setTimeout(() => { void forceRestart(); }, 800);
    };
    window.addEventListener(RESTART_CAMERA_EVENT, handler);
    return () => window.removeEventListener(RESTART_CAMERA_EVENT, handler);
  }, [forceRestart]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!pendingFullscreen) return;

    const host = document.createElement('div');
    host.setAttribute('data-r3a-overlay', 'fullscreen');
    host.style.cssText = [
      'position: fixed', 'inset: 0', 'z-index: 2147483647',
      'background: rgba(0,0,0,.85)', 'display: flex',
      'align-items: center', 'justify-content: center',
      'cursor: pointer', 'color: #fff', 'text-align: center',
      'padding: 32px', "font-family: 'DM Sans', sans-serif",
    ].join(';');

    host.innerHTML = `
      <div>
        <svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 20px;"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
        <h2 style="margin: 0 0 10px; font-family: 'Space Grotesk', sans-serif; font-size: 32px; font-weight: 700;">TAP UNTUK FULLSCREEN</h2>
        <p style="margin: 0; opacity: .7; font-size: 16px;">Browser butuh tap manual di device ini.</p>
      </div>
    `;

    const handleClick = async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen?.();
        }
      } catch { /* ignore */ }
      setPendingFullscreen(false);
    };

    host.addEventListener('click', handleClick);
    document.body.appendChild(host);

    return () => {
      host.removeEventListener('click', handleClick);
      host.remove();
    };
  }, [pendingFullscreen]);
  
useEffect(() => {
  if (phase !== 'frame-select') return;
  const el = frameGridRef.current;
  if (!el) return;

  const handleWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }
  };

  let isDown = false;
  let startX = 0;
  let scrollStart = 0;

  const handleMouseDown = (e: MouseEvent) => {
    isDown = true;
    el.style.cursor = 'grabbing';
    startX = e.pageX - el.offsetLeft;
    scrollStart = el.scrollLeft;
  };
  const handleMouseUp = () => {
    isDown = false;
    el.style.cursor = 'grab';
  };
  const handleMouseLeave = () => {
    isDown = false;
    el.style.cursor = 'grab';
  };
  const handleMouseMove = (e: MouseEvent) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - el.offsetLeft;
    const walk = (x - startX) * 1.2;
    el.scrollLeft = scrollStart - walk;
  };

  el.style.cursor = 'grab';
  el.addEventListener('wheel', handleWheel, { passive: false });
  el.addEventListener('mousedown', handleMouseDown);
  el.addEventListener('mouseup', handleMouseUp);
  el.addEventListener('mouseleave', handleMouseLeave);
  el.addEventListener('mousemove', handleMouseMove);

  return () => {
    el.style.cursor = '';
    el.removeEventListener('wheel', handleWheel);
    el.removeEventListener('mousedown', handleMouseDown);
    el.removeEventListener('mouseup', handleMouseUp);
    el.removeEventListener('mouseleave', handleMouseLeave);
    el.removeEventListener('mousemove', handleMouseMove);
  };
}, [phase]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!pendingRefreshToken) return;

    const host = document.createElement('div');
    host.setAttribute('data-r3a-overlay', 'refresh-token');
    host.style.cssText = [
      'position: fixed', 'inset: 0', 'z-index: 2147483647',
      'background: rgba(0,0,0,.85)', 'display: flex',
      'align-items: center', 'justify-content: center',
      'cursor: pointer', 'color: #fff', 'text-align: center',
      'padding: 32px', "font-family: 'DM Sans', sans-serif",
    ].join(';');

    host.innerHTML = `
      <div>
        <svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 20px;"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/></svg>
        <h2 style="margin: 0 0 10px; font-family: 'Space Grotesk', sans-serif; font-size: 32px; font-weight: 700;">TAP UNTUK REFRESH TOKEN</h2>
        <p style="margin: 0; opacity: .7; font-size: 16px;">Login Google butuh tap manual di device ini.</p>
      </div>
    `;

    const handleClick = async () => {
      let success = false;
      try {
        const result = await connectGoogleDrive(VITE_CLIENT_ID);
        success = result.success;
      } catch { /* ignore */ }
      setPendingRefreshToken(false);
      if (success) {
        setTimeout(() => {
          window.dispatchEvent(new Event(RESTART_CAMERA_EVENT));
        }, 300);
        setTimeout(() => setPendingFullscreen(true), 800);
      }
    };

    host.addEventListener('click', handleClick);
    document.body.appendChild(host);

    return () => {
      host.removeEventListener('click', handleClick);
      host.remove();
    };
  }, [pendingRefreshToken]);

  const frames = event?.frames ?? [];
  const activeFrame = frames[selectedFrameIndex];
  const allSlots = activeFrame?.slots ?? [];
  const uniqueCaptureIds = useMemo(() => getUniqueCaptureIds(allSlots), [allSlots]);
  const totalCapturesNeeded = uniqueCaptureIds.length;

  useEffect(() => {
    eventOpenedAtRef.current = Date.now();
  }, [event?.id, event?.slug]);

  useEffect(() => {
    let cancelled = false;

    const push = async () => {
      if (isPushingRef.current) return;
      isPushingRef.current = true;

      try {
        const token = getTokenStatus();
        const stats = await getUploadStats().catch(() => ({ uploaded: 0, pending: 0, failed: 0 }));
        const todayStats = getTodayStats();
        const driveQuota = token.hasToken ? await getDriveQuota() : { usage: 0, limit: 0 };
        if (cancelled) return;

        void writeStatus({
          currentEventSlug: event?.slug || '',
          currentEventName: event?.eventName || 'Untitled',
          currentPhase: screensaverActive ? 'screensaver' : phase,
          sessionActive: phase !== 'frame-select',
          photoCount: captures.length,
          totalCaptures: totalCapturesNeeded,
          eventOpenedAt: eventOpenedAtRef.current,
          driveConnected: token.hasToken,
          driveAccount: token.account || '',
          driveTokenExpiresAt: token.expiresAt ?? 0,
          driveUsage: driveQuota.usage,
          driveLimit: driveQuota.limit,
          uploadedCount: stats.uploaded,
          pendingCount: stats.pending,
          failedCount: stats.failed,
          todaySessionCount: todayStats.sessionCount,
          todayPhotoCount: todayStats.photoCount,
          qrHistory: qrHistory,
        });
      } finally {
        isPushingRef.current = false;
      }
    };

    void push();
    const id = setInterval(push, 5000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, captures.length, totalCapturesNeeded, event?.slug, event?.eventName, screensaverActive]);

  useEffect(() => {
    markOfflineOnDisconnect();
    return () => { void clearStatus(); };
  }, []);

  useEffect(() => {
    const check = () => {
      const isSaver = document.querySelector('.screensaver-overlay') !== null;
      setScreensaverActive(isSaver);
    };
    const id = setInterval(check, 500);
    check();
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const deviceId = getDeviceId();
    const unsubscribe = subscribeCommands(deviceId, (cmd) => {
      if (!cmd) return;

      try {
        switch (cmd.type) {
          case 'reload-app':
            window.location.reload();
            break;
          case 'clear-cache':
            sessionStorage.clear();
            break;
          case 'retry-all':
            if (VITE_CLIENT_ID) void retryFailedUploads(VITE_CLIENT_ID);
            break;
          case 'reset-uptime':
            resetAppUptime();
            break;
          case 'clear-stats':
            clearAllStats();
            break;
          case 'download-logs':
            downloadLogs();
            break;
          case 'force-fullscreen': {
            setPendingFullscreen(true);
            break;
          }
          case 'reconnect-drive':
          case 'refresh-token': {
            if (!VITE_CLIENT_ID) break;
            setPendingRefreshToken(true);
            break;
          }
          case 'rename-device': {
            if (cmd.payload && typeof cmd.payload === 'string' && cmd.payload.trim()) {
              setDeviceName(cmd.payload.trim());
            }
            break;
          }
        }
      } catch { /* ignore */ }

      void clearCommand(deviceId);
    });
    return unsubscribe;
  }, []);

  const handleLogoClick = useCallback(() => {
    logoClickCount.current += 1;
    if (logoClickTimeout.current) clearTimeout(logoClickTimeout.current);
    if (logoClickCount.current >= 6) {
      logoClickCount.current = 0;
      setShowAdminExit(true);
      return;
    }
    logoClickTimeout.current = setTimeout(() => { logoClickCount.current = 0; }, 2000);
  }, []);

  useEffect(() => {
    if (onPhaseChange) {
      onPhaseChange(screensaverActive ? 'screensaver' : phase);
    }
  }, [phase, onPhaseChange, screensaverActive]);

  useEffect(() => () => { if (logoClickTimeout.current) clearTimeout(logoClickTimeout.current); }, []);

  useEffect(() => {
    const handleOnline = () => {
      const gd = allSettings.googleDrive;
      if (gd.connected && VITE_CLIENT_ID) {
        void retryFailedUploads(VITE_CLIENT_ID);
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [allSettings.googleDrive]);

  useEffect(() => {
    if (!activeFrame?.image) { setFrameAspect(3 / 2); return; }
    const img = new Image();
    img.onload = () => setFrameAspect(img.naturalWidth / img.naturalHeight);
    img.src = activeFrame.image;
  }, [activeFrame?.image]);

  useEffect(() => {
    setFramesReady(true);
  }, [frames.length]);

  const resetSession = useCallback(() => {
    setFlash(false);
    setCaptures([]);
    setCurrentCaptureIndex(0);
    setCaptureFilters(new Map());
    setSelectedCaptureId(null);
    setCompositeUrl(null);
    setCompositeColorUrl(null);
    setShowPrintPreview(false);
    setSaved(false);
    setSaving(false);
    setQrDataUrl(null);
    setResultId('');
    setPrinted(false);
    setPrinting(false);
    setCaptureError(null);
    setQrError(false);
    setDriveQrDataUrl(null);
    setDriveQrError(false);
    setCapturePreviewUrl(null);
    sessionStartedAtRef.current = null;
    imageCacheRef.current.clear();
  }, []);

  const handleStartCapture = useCallback(async () => {
    resetSession();
    setGuestError(null);
    sessionStartedAtRef.current = Date.now();

    const gd = allSettings.googleDrive;
    if (gd.connected && VITE_CLIENT_ID && gd.mainFolderId) {
      setGuestAssigning(true);
      const result = await getOrCreateNextGuestFolder(event.id, gd.mainFolderId, VITE_CLIENT_ID);
      setGuestAssigning(false);
      if (result.success && result.guest) {
        setCurrentGuest(result.guest);
      } else {
        setGuestError(result.error || 'Failed to create guest folder');
      }
    }

    setPhase('live');
  }, [resetSession, allSettings.googleDrive, event.id]);

  const handleSelectFrame = useCallback((index: number) => {
    if (version === 'v1.0.0') {
      const gateEnabled = allSettings.system.igGateEnabled !== false;
      if (gateEnabled) {
        setPendingFrameIndex(index);
        setShowIGGate(true);
        return;
      }
    }

    if (version === 'v2.0.0' || version === 'v2.1.0') {
      const payment = allSettings.payment;
      const requirePayment = payment?.requirePayment !== false;
      if (requirePayment) {
        setPendingFrameIndex(index);
        setShowQRISGate(true);
        return;
      }
    }

    setSelectedFrameIndex(index);
    resetSession();
    setPhase('ready');
  }, [resetSession, allSettings.system.igGateEnabled, allSettings.payment, version]);

  const handleIGGateDismiss = useCallback(() => {
    if (pendingFrameIndex !== null) {
      setSelectedFrameIndex(pendingFrameIndex);
      setPendingFrameIndex(null);
    }
    setShowIGGate(false);
    void handleStartCapture();
  }, [pendingFrameIndex, handleStartCapture]);

  const handleQRISConfirm = useCallback(() => {
    if (pendingFrameIndex !== null) {
      setSelectedFrameIndex(pendingFrameIndex);
      setPendingFrameIndex(null);
    }
    setShowQRISGate(false);
    void handleStartCapture();
  }, [pendingFrameIndex, handleStartCapture]);

  const handleQRISCancel = useCallback(() => {
    setPendingFrameIndex(null);
    setShowQRISGate(false);
  }, []);

  const isVideoReady = useCallback((video: HTMLVideoElement | null): boolean => {
    return !!(video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0);
  }, []);

  const handleCapture = useCallback(() => {
    if (phase !== 'live') return;
    const video = videoRef.current;
    if (!isVideoReady(video)) {
      setCaptureError({ message: 'Camera not ready. Please wait for the video feed to load.' });
      setTimeout(() => setCaptureError(null), 3000);
      return;
    }
    setCaptureError(null);
    setPhase('countdown');
    setCountdown(5);
  }, [phase, isVideoReady]);

  useEffect(() => {
    if (phase !== 'countdown' || countdown === 0) return;
    let preFlashTimer: ReturnType<typeof setTimeout> | null = null;
    if (countdown === 1) {
      preFlashTimer = setTimeout(() => { setFlash(true); }, 700);
    }
    const timer = setTimeout(() => {
      if (countdown <= 1) {
        const video = videoRef.current;
        if (video && isVideoReady(video)) {
          const dataUrl = captureFromVideo(video, cameraSettings.mirror);
          const capId = uniqueCaptureIds[currentCaptureIndex];
          const newCapture: CaptureData = { captureId: capId, dataUrl };
          setCaptures((prev) => [...prev, newCapture]);
          setCapturePreviewUrl(dataUrl);
          void saveCapture({
            id: `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            eventId: event.id,
            captureId: capId,
            dataUrl,
            filterId: 'natural',
            createdAt: Date.now(),
          } as StoredCapture);
        } else {
          setCaptureError({ message: 'Camera not ready at capture time. Please retry.' });
          setTimeout(() => setCaptureError(null), 3000);
        }
        if (currentCaptureIndex + 1 < totalCapturesNeeded) {
          setCurrentCaptureIndex((i) => i + 1);
        }
        setCountdown(0);
      } else {
        setCountdown((c) => c - 1);
      }
    }, 1000);
    return () => { clearTimeout(timer); if (preFlashTimer) clearTimeout(preFlashTimer); };
  }, [phase, countdown, currentCaptureIndex, totalCapturesNeeded, uniqueCaptureIds, cameraSettings.mirror, event.id, isVideoReady]);

  useEffect(() => {
    if (!capturePreviewUrl) return;
    const t = setTimeout(() => setCapturePreviewUrl(null), 2000);
    return () => clearTimeout(t);
  }, [capturePreviewUrl]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown !== 0) return;
    if (capturePreviewUrl) return;
    if (captures.length === 0) return;

    if (captures.length >= totalCapturesNeeded) {
      setSelectedCaptureId(uniqueCaptureIds[0] ?? null);
      setPhase('filter');
      return;
    }

    const t = setTimeout(() => setCountdown(5), 400);
    return () => clearTimeout(t);
  }, [phase, countdown, capturePreviewUrl, captures.length, totalCapturesNeeded, uniqueCaptureIds]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), 600);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => () => { setFlash(false); }, []);

  const handleComposite = useCallback(async () => {
    if (!activeFrame) return;
    setPhase('compositing');
    const captureMap = new Map<string, string>();
    for (const c of captures) captureMap.set(c.captureId, c.dataUrl);
    
    try {
      if (isReceiptMode) {
        const bwFilters = new Map<string, string>();
        for (const c of captures) bwFilters.set(c.captureId, 'grayscale'); 
        
        const resultBW = await compositeFrame(activeFrame, captureMap, bwFilters, true);
        setCompositeUrl(resultBW);

        const resultColor = await compositeFrame(activeFrame, captureMap, captureFilters, true);
        setCompositeColorUrl(resultColor);
      } else {
        const result = await compositeFrame(activeFrame, captureMap, captureFilters, false);
        setCompositeUrl(result);
        setCompositeColorUrl(null);
      }
      
      setPhase('result');
    } catch {
      setPhase('filter');
    }
  }, [activeFrame, captures, captureFilters, isReceiptMode]);

  const handleSave = useCallback(async () => {
    if (!compositeUrl || !activeFrame) return;
    if (saving) return;
    setSaving(true);

    try {
      const id = `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result: StoredResult = {
        id, eventId: event.id, frameId: activeFrame.id, dataUrl: compositeUrl, filterId: 'multi', createdAt: Date.now(),
      };
      await saveResult(result);
      setResultId(id);

      const captureMap = new Map(captures.map((c) => [c.captureId, c.dataUrl]));
      
      const slotPhotosBW: { index: number; dataUrl: string }[] = [];
      const slotPhotosColor: { index: number; dataUrl: string }[] = [];

      const seenCaptureIds = new Set<string>();
      let photoIndex = 1;
      for (const slot of allSlots) {
        if (seenCaptureIds.has(slot.captureId)) continue;
        seenCaptureIds.add(slot.captureId);

        const cap = captureMap.get(slot.captureId);
        if (!cap) continue;
        try {
          if (isReceiptMode) {
            const bwDataUrl = await generateSlotPhoto(slot, cap, 'grayscale', activeFrame);
            const colorDataUrl = await generateSlotPhoto(slot, cap, captureFilters.get(slot.captureId) || 'natural', activeFrame);
            slotPhotosBW.push({ index: photoIndex, dataUrl: bwDataUrl });
            slotPhotosColor.push({ index: photoIndex, dataUrl: colorDataUrl });
          } else {
            const colorDataUrl = await generateSlotPhoto(slot, cap, captureFilters.get(slot.captureId) || 'natural', activeFrame);
            slotPhotosColor.push({ index: photoIndex, dataUrl: colorDataUrl });
          }
          photoIndex++;
        } catch { /* skip */ }
      }

      let slideshowVideo: string | null = null;
      if (allSettings.storage.saveVideos) {
        const rawSlotPhotos: { index: number; dataUrl: string }[] = [];
        for (let i = 0; i < allSlots.length; i++) {
          const cap = captureMap.get(allSlots[i].captureId);
          if (cap) rawSlotPhotos.push({ index: i + 1, dataUrl: cap });
        }
        if (rawSlotPhotos.length > 0) {
          try {
            const DURATION_PER_SLIDE_MS = 700;
            const LOOP_COUNT = 3;
            const loopedPhotos: { dataUrl: string }[] = [];
            for (let loop = 0; loop < LOOP_COUNT; loop++) {
              for (const p of rawSlotPhotos) loopedPhotos.push({ dataUrl: p.dataUrl });
            }
            slideshowVideo = await generateSlideshowVideo(loopedPhotos, DURATION_PER_SLIDE_MS);
          } catch { slideshowVideo = null; }
        }
      }

      if (allSettings.storage.autoDownloadResult) {
        void saveFileFromDataUrl(compositeUrl, generateFileName('jpg'));
        
        if (isReceiptMode && compositeColorUrl) {
          void saveFileFromDataUrl(compositeColorUrl, generateFileName('jpg'));
        }

        for (const sp of slotPhotosBW) {
          void saveFileFromDataUrl(sp.dataUrl, generateFileName('jpg'));
        }
        for (const sp of slotPhotosColor) {
          void saveFileFromDataUrl(sp.dataUrl, generateFileName('jpg'));
        }

        if (slideshowVideo) {
          void saveFileFromDataUrl(slideshowVideo, generateFileName(guessVideoExtension(slideshowVideo)));
        }
      }

      const gd = allSettings.googleDrive;
      let uploadSuccessCount = 0;
      const uploadFailCount = 0;

      if (gd.connected && VITE_CLIENT_ID && currentGuest) {
        const uploadFiles: UploadFileEntry[] = [
          { fileName: generateFileName('jpg'), dataUrl: compositeUrl },
          ...(isReceiptMode && compositeColorUrl ? [{ fileName: generateFileName('jpg'), dataUrl: compositeColorUrl }] : []),
          ...slotPhotosBW.map((sp) => ({ fileName: generateFileName('jpg'), dataUrl: sp.dataUrl })),
          ...slotPhotosColor.map((sp) => ({ fileName: generateFileName('jpg'), dataUrl: sp.dataUrl })),
          ...(slideshowVideo ? [{ fileName: generateFileName(guessVideoExtension(slideshowVideo)), dataUrl: slideshowVideo }] : []),
        ];
        void autoUploadToGuestFolder(currentGuest, VITE_CLIENT_ID, uploadFiles);
        uploadSuccessCount = uploadFiles.length;
      }

      try {
        const startedAt = sessionStartedAtRef.current ?? (Date.now() - 60000);
        recordSession({ id, eventId: event.id, startedAt, finishedAt: Date.now(), photoCount: slotPhotosColor.length, uploadSuccess: uploadSuccessCount, uploadFail: uploadFailCount });
      } catch { /* ignore */ }

      setSaved(true);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }, [compositeUrl, compositeColorUrl, activeFrame, event.id, allSettings, allSlots, captures, captureFilters, currentGuest, saving, isReceiptMode]);
  
  const handleShowQr = useCallback(async () => {
    if (!currentGuest) return;
    setQrError(false); setQrDataUrl(null); setPhase('qr');
    const payload = buildDriveResultPayload(currentGuest.guestFolderId, event.name);
    try {
      const qr = await generateQrCode(payload);
      if (qr.qrDataUrl) {
        setQrDataUrl(qr.qrDataUrl);
        
        const newQr = {
          id: `qr-${Date.now()}`,
          url: payload,
          type: 'result-qr',
          time: Date.now()
        };
        setQrHistory(prev => [...prev, newQr].slice(-5));
        
      } else setQrError(true);
    } catch { setQrError(true); }
  }, [currentGuest, event.name]);

  const handleShowDriveQr = useCallback(async () => {
    if (!currentGuest) return;
    setDriveQrError(false); setDriveQrDataUrl(null); setPhase('drive-qr');
    try {
      const url = buildDriveFolderUrl(currentGuest.guestFolderId);
      const qr = await generateQrCode(url);
      if (qr.qrDataUrl) {
        setDriveQrDataUrl(qr.qrDataUrl);
        
        const newQr = {
          id: `qr-${Date.now()}`,
          url: url,
          type: 'drive-qr',
          time: Date.now()
        };
        setQrHistory(prev => [...prev, newQr].slice(-5));

      } else setDriveQrError(true);
    } catch { setDriveQrError(true); }
  }, [currentGuest]);

  const handlePrint = useCallback(async () => {
    if (!compositeUrl || printing) return;
    setPrinting(true);
    try {
      const ps = event.printerSettings;
      const copies = Math.max(1, Math.min(5, ps.copies || 1));
      await printResult({
        copies,
        paperSize: ps.paperSize || '4 × 6 in',
        layout: ps.layout || 'POTRAIT',
        dataUrl: compositeUrl, 
        printerName: allSettings.printer.printer || ps.printer,
      });
      setPrinted(true);
    } catch { /* ignore */ }
    setPrinting(false);
  }, [compositeUrl, printing, event.printerSettings, allSettings.printer]);

  const handleBackToFrameSelect = useCallback(() => {
    resetSession();
    setCurrentGuest(null);
    setGuestError(null);
    setPhase('frame-select');
  }, [resetSession]);

  useEffect(() => {
    const idlePhases: SessionPhase[] = ['frame-select', 'live', 'filter', 'result', 'qr', 'drive-qr'];
    const isIdlePhase = idlePhases.includes(phase);
    const isPaused = saving || printing || guestAssigning || phase === 'countdown' || phase === 'compositing';
    const timeoutMin = allSettings.display.idleTimeoutMin ?? 5;
    const timeoutMs = timeoutMin * 60 * 1000;

    if (!isIdlePhase || isPaused || timeoutMs <= 0) {
      setIdleWarning(0);
      return;
    }

    let warningTimer: number | null = null;
    let resetTimer: number | null = null;

    const doReset = () => {
      resetSession();
      setCurrentGuest(null);
      setGuestError(null);
      setPhase('frame-select');
      setIdleWarning(0);
    };

    const bump = () => {
      if (warningTimer !== null) {
        window.clearInterval(warningTimer);
        warningTimer = null;
      }
      if (resetTimer !== null) {
        window.clearTimeout(resetTimer);
        resetTimer = null;
      }
      setIdleWarning(0);

      resetTimer = window.setTimeout(() => {
        let left = 10;
        setIdleWarning(left);
        warningTimer = window.setInterval(() => {
          left -= 1;
          if (left <= 0) {
            if (warningTimer !== null) window.clearInterval(warningTimer);
            warningTimer = null;
            doReset();
          } else {
            setIdleWarning(left);
          }
        }, 1000);
      }, Math.max(1000, timeoutMs - 10000));
    };

    const events = ['mousemove', 'click', 'touchstart', 'keydown', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));

    bump();

    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      if (warningTimer !== null) window.clearInterval(warningTimer);
      if (resetTimer !== null) window.clearTimeout(resetTimer);
    };
  }, [phase, saving, printing, guestAssigning, allSettings.display.idleTimeoutMin, resetSession]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (phase === 'frame-select') { onExit(); }
        else { setShowAdminExit(true); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase, onExit]);

  const captureMap = useMemo(() => new Map(captures.map((c) => [c.captureId, c.dataUrl])), [captures]);

  const ensureImagesCached = useCallback(async (sources: string[]): Promise<void> => {
    const cache = imageCacheRef.current;
    const missing = sources.filter((src) => src && !cache.has(src));
    if (missing.length === 0) return;
    await Promise.all(
      missing.map((src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => { cache.set(src, img); resolve(); };
          img.onerror = () => resolve();
          img.src = src;
        }),
      ),
    );
  }, []);

  useEffect(() => {
    if (phase !== 'filter') return;
    const area = previewAreaRef.current;
    const frame = previewFrameRef.current;
    const canvas = previewCanvasRef.current;
    if (!area || !frame || !canvas) return;
    if (!activeFrame) return;

    let cancelled = false;
    let rafId: number;

    const render = () => {
      if (cancelled) return;
      const areaRect = area.getBoundingClientRect();
      const availW = Math.max(50, areaRect.width);
      const availH = Math.max(50, areaRect.height - 60);

      let frameW = availW;
      let frameH = frameW / frameAspect;
      if (frameH > availH) { frameH = availH; frameW = frameH * frameAspect; }
      frameW = Math.floor(frameW);
      frameH = Math.floor(frameH);

      frame.style.width = `${frameW}px`;
      frame.style.height = `${frameH}px`;
      frame.style.aspectRatio = 'auto';

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvasW = Math.max(1, Math.floor(frameW * dpr));
      const canvasH = Math.max(1, Math.floor(frameH * dpr));
      if (canvas.width !== canvasW || canvas.height !== canvasH) {
        canvas.width = canvasW; canvas.height = canvasH;
      }
      canvas.style.width = `${frameW}px`;
      canvas.style.height = `${frameH}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, frameW, frameH);
      ctx.fillStyle = '#2a2522';
      ctx.fillRect(0, 0, frameW, frameH);

      const cache = imageCacheRef.current;

      if (isReceiptMode && activeFrame.image) {
        const frameImg = cache.get(activeFrame.image);
        if (frameImg) ctx.drawImage(frameImg, 0, 0, frameW, frameH);
      }

      for (const slot of allSlots) {
        const cap = captureMap.get(slot.captureId);
        if (!cap) continue;
        const photo = cache.get(cap);
        if (!photo) continue;

        const sx = (slot.x / 100) * frameW;
        const sy = (slot.y / 100) * frameH;
        const sw = (slot.w / 100) * frameW;
        const sh = (slot.h / 100) * frameH;
        const filterId = captureFilters.get(slot.captureId) || 'natural';
        const glow = isGlowFilter(filterId);
        const baseCss = glow ? 'brightness(1.08) saturate(1.15)' : getFilterCss(filterId);

        ctx.save();
        ctx.beginPath();
        ctx.rect(sx, sy, sw, sh);
        ctx.clip();
        ctx.filter = baseCss;
        drawPhotoCovered(ctx, photo, sx, sy, sw, sh);
        ctx.filter = 'none';
        if (glow) applyGlowToCanvas(ctx, photo, sx, sy, sw, sh);
        ctx.restore();
      }

      if (!isReceiptMode && activeFrame.image) {
        const frameImg = cache.get(activeFrame.image);
        if (frameImg) ctx.drawImage(frameImg, 0, 0, frameW, frameH);
      }
    };

    const sources = [activeFrame.image, ...allSlots.map((s) => captureMap.get(s.captureId) || '')].filter(Boolean);

    const run = async () => {
      await ensureImagesCached(sources);
      if (cancelled) return;
      rafId = requestAnimationFrame(render);
    };

    void run();
    const onResize = () => { if (!cancelled) rafId = requestAnimationFrame(render); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [phase, activeFrame, allSlots, captureMap, captureFilters, frameAspect, ensureImagesCached, isReceiptMode]);

  const LoadingOverlay = saving ? (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999999, background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28, color: '#fff', backdropFilter: 'blur(4px)' }}>
      <div className="compositing-spinner" style={{ width: 72, height: 72, borderWidth: 5 }} />
      <span style={{ fontSize: 32, fontWeight: 700, letterSpacing: '.25em', textTransform: 'uppercase', color: '#fff' }}>PROSES FOTO</span>
    </div>
  ) : null;

  if (!event || !event.frames) {
    return (
      <main className="photobooth-screen photobooth-kiosk" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <AlertCircle size={48} strokeWidth={1} />
        <h2 style={{ fontSize: 24, margin: 0 }}>Event not found</h2>
        <p style={{ color: 'rgba(255,255,255,.5)', margin: 0 }}>The event data is missing or malformed.</p>
        <button onClick={onExit} type="button" style={{ marginTop: 8, padding: '10px 24px', background: '#ef3f25', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}>BACK</button>
      </main>
    );
  }

  if (!framesReady) {
    return (
      <main className="photobooth-screen photobooth-kiosk" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="compositing-spinner" />
        <span style={{ color: 'rgba(255,255,255,.5)', fontSize: 14, fontWeight: 600, letterSpacing: '.1em' }}>LOADING EVENT...</span>
      </main>
    );
  }

  if (phase === 'frame-select') {
    return (
      <main className="photobooth-screen photobooth-kiosk">
        {LoadingOverlay}
        {showIGGate ? (
          <IGFollowGate imageSrc={igGateImage} onDismiss={handleIGGateDismiss} />
        ) : null}
        {showQRISGate ? (
          <QRISGate
            qrisImageUrl={allSettings.payment?.qrisImageUrl || ''}
            price={allSettings.payment?.price || 25000}
            onConfirm={handleQRISConfirm}
            onCancel={handleQRISCancel}
          />
        ) : null}
        <div className="photobooth-kiosk-header">
          <div className="photobooth-project"><span>R3A BOOTH</span><strong>{event.eventName || 'Untitled Event'}</strong></div>
          <div className="hidden-exit-trigger" onClick={handleLogoClick} />
        </div>
        <section className="frame-select-section">
          <h1>CHOOSE A FRAME</h1>
          <p>Select a frame layout to begin your photo session</p>
          {frames.length === 0 ? (
            <div className="frame-select-empty">
              <ImageIcon size={48} strokeWidth={1} />
              <strong>No frames available</strong>
              <p>This event has no frames configured. Ask the operator to add frames.</p>
            </div>
          ) : (
            <div className="frame-select-grid">
              {frames.map((frame, i) => {
                const showCount = frame.showPhotoCount !== false && frame.slots.length > 0;
                const displayName = frame.name?.trim() || `Frame ${i + 1}`;
                return (
                  <button
                    key={frame.id}
                    className="frame-select-card"
                    onClick={() => handleSelectFrame(i)}
                    type="button"
                  >
                    <div className="frame-select-thumb">
                      {/* 🔧 HANYA TAMPILKAN GAMBAR DUMMY (JIKA ADA) ATAU FRAME UTAMA DI SINI */}
                      {(frame.showDummyPreview && frame.dummyPreviewImage) ? (
                        <img src={frame.dummyPreviewImage} alt={displayName} />
                      ) : frame.image ? (
                        <img src={frame.image} alt={displayName} />
                      ) : (
                        <div className="frame-select-thumb-empty">
                          <ImageIcon size={32} strokeWidth={1} />
                        </div>
                      )}
                      
                      <div className="frame-select-thumb-overlay" />
                      <div className="frame-select-thumb-top">
                        <span className="frame-select-name">{displayName}</span>
                        {showCount ? (
                          <span className="frame-select-count">{frame.slots.length}×</span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </main>
    );
  }

  if (phase === 'ready') {
    return (
      <main className="photobooth-screen photobooth-kiosk">
        {LoadingOverlay}
        <div className="photobooth-kiosk-header">
          <div className="photobooth-project" onClick={handleLogoClick}><span>R3A BOOTH</span><strong>{event.eventName || 'Untitled Event'}</strong></div>
          <button className="photobooth-exit" onClick={handleBackToFrameSelect} type="button"><X size={24} /> BACK</button>
        </div>
        <section className="ready-section">
          <div className="ready-frame-preview" style={{ aspectRatio: frameAspect }}>
            {activeFrame?.image ? <img src={activeFrame.image} alt={activeFrame.name} /> : <div className="ready-frame-placeholder"><ImageIcon size={48} strokeWidth={1} /></div>}
            {allSlots.map((slot) => {
              const cap = captureMap.get(slot.captureId);
              if (cap) return null;
              return (
                <div key={slot.id} className="ready-slot-outline" style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%`, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {/* 🔧 TAMPILKAN DUMMY DI SINI SAAT READY */}
                  {activeFrame.showDummyPreview && activeFrame.dummyPreviewImage ? (
                    <img src={activeFrame.dummyPreviewImage} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span>{slot.captureId}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="ready-info">
            <h2>{activeFrame?.name || 'FRAME'}</h2>
            <p>{totalCapturesNeeded} PHOTO{totalCapturesNeeded !== 1 ? 'S' : ''} TO CAPTURE</p>
            <button className="ready-start" onClick={handleStartCapture} type="button" disabled={guestAssigning}>
              <Camera size={28} /> {guestAssigning ? 'PREPARING...' : 'START SESSION'}
            </button>
            <button className="ready-back" onClick={handleBackToFrameSelect} type="button">
              <ChevronLeft size={18} /> CHANGE FRAME
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`photobooth-screen ${phase === 'live' || phase === 'countdown' ? '' : 'photobooth-kiosk'}`}>
      {LoadingOverlay}
      {flash ? <div className="capture-flash" /> : null}

      {capturePreviewUrl ? (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 150,
            background: 'rgba(0,0,0,.92)', display: 'grid',
            placeItems: 'center', pointerEvents: 'none',
            animation: 'r3a-preview-fade .25s ease-out',
          }}
        >
          <img
            src={capturePreviewUrl}
            alt="Capture preview"
            style={{
              maxWidth: '92vw', maxHeight: '90vh',
              objectFit: 'contain',
              boxShadow: '0 20px 60px rgba(0,0,0,.6)',
              animation: 'r3a-preview-zoom .35s ease-out',
            }}
          />
          <div
            style={{
              position: 'absolute', bottom: 40, left: '50%',
              transform: 'translateX(-50%)',
              padding: '10px 26px',
              background: 'rgba(239,63,37,.92)', color: '#fff',
              fontWeight: 700, letterSpacing: '.18em', fontSize: 14,
              borderRadius: 50,
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            FOTO {Math.min(captures.length, totalCapturesNeeded)} / {totalCapturesNeeded}
          </div>
          <style>{`
            @keyframes r3a-preview-fade { from { opacity: 0; } to { opacity: 1; } }
            @keyframes r3a-preview-zoom { from { transform: scale(.88); } to { transform: scale(1); } }
          `}</style>
        </div>
      ) : null}

      {phase === 'live' || phase === 'countdown' ? (
        <>
          <div className="photobooth-header photobooth-guest-header">
            <button className="photobooth-back-btn" onClick={handleBackToFrameSelect} type="button"><ChevronLeft size={20} /> BACK</button>
            <div className="photobooth-project" onClick={handleLogoClick}><span>R3A BOOTH</span><strong>{event.eventName || 'Untitled Event'}</strong></div>
            {currentGuest ? <span className="photobooth-guest-badge">{currentGuest.guestName}</span> : null}
          </div>
          <section className="photobooth-main">
            {stream ? (
              <>
                <div className="photobooth-video-wrap">
                  <CameraPreview stream={stream} mirror={cameraSettings.mirror} aspectRatio={cameraSettings.aspectRatio} className="photobooth-video" />
                  {phase === 'countdown' && countdown > 0 ? (
                    <div className="countdown-overlay"><span className="countdown-number">{countdown}</span></div>
                  ) : null}
                </div>
                <HiddenVideoCapture videoRef={videoRef} stream={stream} />
              </>
            ) : (
              <div className="photobooth-preview">
                {status === 'error' ? (
                  <><AlertCircle size={48} strokeWidth={1} /><span>CAMERA ERROR</span><em>{error ? errorMessages[error] : 'Unable to start camera.'}</em></>
                ) : (
                  <><Camera size={64} strokeWidth={1} /><span>{status === 'connecting' ? 'CONNECTING CAMERA...' : 'CAMERA PREVIEW'}</span><em>{status === 'connecting' ? 'Starting camera stream...' : 'Camera not connected.'}</em></>
                )}
              </div>
            )}
          </section>
          <div className="photobooth-controls">
            <button className="photobooth-capture" type="button" disabled={!stream || phase === 'countdown' || totalCapturesNeeded === 0} onClick={handleCapture}>
              <Camera size={32} /> {phase === 'countdown' ? `AUTO ${currentCaptureIndex + 1}/${totalCapturesNeeded}` : `CAPTURE ALL (${totalCapturesNeeded})`}
            </button>
          </div>
          <div className="photobooth-camera-status"><CameraStatusBadge status={status} error={error} /></div>
          <div className="photobooth-capture-info"><span>PHOTO {Math.min(currentCaptureIndex + 1, totalCapturesNeeded)} / {totalCapturesNeeded}</span></div>
          {captureError ? <div className="photobooth-capture-error"><AlertCircle size={20} /> {captureError.message}</div> : null}
          {guestError ? <div className="photobooth-capture-error"><AlertCircle size={20} /> GUEST FOLDER: {guestError}</div> : null}

          <div className="photobooth-slots">
            <div
              className="photobooth-frame-preview"
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: String(frameAspect),
                background: '#2a2522',
                overflow: 'hidden',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,.15)',
              }}
            >
              {isReceiptMode && activeFrame?.image ? (
                <img
                  src={activeFrame.image}
                  alt=""
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'fill',
                    pointerEvents: 'none',
                    zIndex: 1,
                  }}
                />
              ) : null}

              {allSlots.map((slot) => {
                const cap = captureMap.get(slot.captureId);
                const isNext = uniqueCaptureIds.indexOf(slot.captureId) === currentCaptureIndex;
                
                if (cap) {
                  return (
                    <img
                      key={slot.id}
                      src={cap}
                      alt={slot.captureId}
                      style={{
                        position: 'absolute',
                        left: `${slot.x}%`,
                        top: `${slot.y}%`,
                        width: `${slot.w}%`,
                        height: `${slot.h}%`,
                        objectFit: 'cover',
                        zIndex: 2,
                        outline: isNext ? '2px solid #ef3f25' : 'none',
                        outlineOffset: -2,
                      }}
                    />
                  );
                }

                // 🔧 TAMPILKAN DUMMY DI LIVE JIKA SLOT KOSONG
                if (activeFrame.showDummyPreview && activeFrame.dummyPreviewImage) {
                  return (
                    <img
                      key={slot.id}
                      src={activeFrame.dummyPreviewImage}
                      alt="Dummy"
                      style={{
                        position: 'absolute',
                        left: `${slot.x}%`,
                        top: `${slot.y}%`,
                        width: `${slot.w}%`,
                        height: `${slot.h}%`,
                        objectFit: 'cover',
                        zIndex: 2,
                        outline: isNext ? '2px solid #ef3f25' : 'none',
                        outlineOffset: -2,
                        opacity: 0.8
                      }}
                    />
                  );
                }

                return null;
              })}
              
              {!isReceiptMode && activeFrame?.image ? (
                <img
                  src={activeFrame.image}
                  alt=""
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'fill',
                    pointerEvents: 'none',
                    zIndex: 3,
                  }}
                />
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {phase === 'filter' ? (
        <section className="photobooth-filter-section">
          <div className="filter-header">
            <h2>SELECT FILTER</h2>
            <p>Tap a photo slot to select it, then choose a filter.</p>
          </div>
          <div ref={previewAreaRef} className="filter-preview-area">
            <div ref={previewFrameRef} className="filter-preview-frame" style={{ position: 'relative', overflow: 'hidden', background: '#2a2522', margin: '0 auto' }}>
              <canvas ref={previewCanvasRef} style={{ position: 'absolute', top: 0, left: 0, display: 'block', zIndex: 1, pointerEvents: 'none' }} />
              {allSlots.map((slot) => {
                const cap = captureMap.get(slot.captureId);
                if (!cap) return null;
                const isSelected = selectedCaptureId === slot.captureId;
                return (
                  <div key={slot.id} onClick={() => setSelectedCaptureId(slot.captureId)}
                    style={{ position: 'absolute', left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%`, border: isSelected ? '2px solid #ffd94e' : '2px solid transparent', boxShadow: isSelected ? '0 0 0 2px rgba(255,217,78,.4)' : 'none', cursor: 'pointer', zIndex: 10, boxSizing: 'border-box' }}>
                    {isSelected ? (
                      <div style={{ position: 'absolute', bottom: 6, left: 6, padding: '3px 10px', background: '#ffd94e', color: '#1a1614', fontSize: 10, fontWeight: 800, borderRadius: 4, letterSpacing: '.08em' }}>SELECTED</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          {selectedCaptureId ? (
            <div className="filter-options">
              {FILTERS.map((f) => {
                const currentFilter = captureFilters.get(selectedCaptureId) || 'natural';
                return (
                  <button key={f.id} className={currentFilter === f.id ? 'is-active' : ''}
                    onClick={() => { setCaptureFilters((prev) => { const next = new Map(prev); next.set(selectedCaptureId, f.id); return next; }); }}
                    type="button">
                    <span className="filter-thumb" style={{ filter: f.css }}><FilterIcon size={18} /></span>
                    {f.name}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="filter-actions">
            <button className="filter-back" onClick={() => { resetSession(); setPhase('live'); }} type="button"><RotateCcw size={18} /> RETAKE</button>
            <button className="filter-compose" onClick={handleComposite} type="button"><ImageIcon size={18} /> COMPOSITE</button>
          </div>
        </section>
      ) : null}

      {phase === 'compositing' ? (
        <section className="photobooth-compositing"><div className="compositing-spinner" /><span>COMPOSITING...</span></section>
      ) : null}

      {phase === 'result' && (compositeUrl || compositeColorUrl) ? (
        <section className="photobooth-result-section">
          <div className="result-header"><h2>YOUR PHOTO IS READY</h2></div>
          
          <div className="result-preview">
            <img 
              src={isReceiptMode && !showPrintPreview && compositeColorUrl ? compositeColorUrl : compositeUrl} 
              alt="Final result" 
            />
          </div>

          {isReceiptMode && compositeColorUrl && (
            <button 
              className="result-toggle-preview" 
              onClick={() => setShowPrintPreview(!showPrintPreview)}
              style={{
                margin: '0 auto 20px',
                padding: '10px 20px',
                background: 'rgba(255,255,255,.1)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,.3)',
                borderRadius: '30px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              <Eye size={18} /> 
              {showPrintPreview ? 'LIHAT HASIL WARNA' : 'LIHAT HASIL CETAK'}
            </button>
          )}

          <div className="result-actions">
            <button className="result-save" onClick={handleSave} disabled={saved || saving} type="button">
              {saving ? <>PROSES...</> : saved ? <><Check size={18} /> SAVED</> : <><Check size={18} /> SAVE</>}
            </button>
            {(event.printerSettings.enabled && allSettings.display.showPrintButton) ? (
              <button className="result-print" onClick={handlePrint} disabled={!saved || saving || printing || printed} type="button">
                <Printer size={18} /> {printing ? 'PRINTING...' : printed ? 'PRINTED' : (loadAppVersion() === 'v2.1.0' ? 'CETAK STRUK' : 'PRINT')}
              </button>
            ) : null}
            {allSettings.display.showQrButton ? (
              <button className="result-qr" onClick={handleShowQr} disabled={!saved || saving} type="button"><QrCode size={18} /> QR CODE</button>
            ) : null}
            {currentGuest && allSettings.display.showDriveQrButton ? (
              <button className="result-qr" onClick={handleShowDriveQr} disabled={!saved || saving} type="button"><QrCode size={18} /> DRIVE QR</button>
            ) : null}
          </div>
          <button
            className={`result-done ${saved ? 'is-saved' : ''}`}
            onClick={handleBackToFrameSelect}
            disabled={!saved || saving}
            type="button"
          >
            <RefreshCw size={18} /> DONE
          </button>
        </section>
      ) : null}

      {phase === 'qr' ? (
        <section className="photobooth-qr-section">
          <div className="qr-header"><h2>SCAN TO VIEW</h2><p>Scan this QR code with your phone to view your photo</p></div>
          <div className="qr-display">
            {qrError ? (
              <div className="qr-error-state"><AlertCircle size={48} strokeWidth={1} /><span>QR GENERATION FAILED</span><button type="button" onClick={handleShowQr} className="qr-retry">RETRY</button></div>
            ) : qrDataUrl ? <img src={qrDataUrl} alt="QR Code" /> : <div className="qr-loading"><div className="compositing-spinner" /></div>}
          </div>
          <div className="qr-actions">
            <button className="qr-back-result" onClick={() => setPhase('result')} type="button"><ChevronLeft size={18} /> BACK</button>
            <button className="qr-new-session" onClick={handleBackToFrameSelect} type="button"><RefreshCw size={18} /> NEW SESSION</button>
          </div>
        </section>
      ) : null}

      {phase === 'drive-qr' ? (
        <section className="photobooth-qr-section">
          <div className="qr-header"><h2>SCAN TO GET YOUR PHOTOS</h2><p>Scan untuk mengambil foto</p></div>
          <div className="qr-display">
            {driveQrError ? (
              <div className="qr-error-state"><AlertCircle size={48} strokeWidth={1} /><span>QR GENERATION FAILED</span><button type="button" onClick={handleShowDriveQr} className="qr-retry">RETRY</button></div>
            ) : driveQrDataUrl ? <img src={driveQrDataUrl} alt="Google Drive QR Code" /> : <div className="qr-loading"><div className="compositing-spinner" /></div>}
          </div>
          <div className="qr-actions">
            <button className="qr-back-result" onClick={() => setPhase('result')} type="button"><ChevronLeft size={18} /> BACK</button>
            <button className="qr-new-session" onClick={handleBackToFrameSelect} type="button"><RefreshCw size={18} /> DONE</button>
          </div>
        </section>
      ) : null}

      {showAdminExit ? (
        <div className="admin-exit-overlay" onClick={() => setShowAdminExit(false)}>
          <div className="admin-exit-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Exit Event?</h3>
            <div className="admin-exit-actions">
              <button onClick={() => setShowAdminExit(false)} type="button">CANCEL</button>
              <button className="admin-exit-confirm" onClick={() => { setShowAdminExit(false); onExit(); }} type="button">EXIT EVENT</button>
            </div>
          </div>
        </div>
      ) : null}

      {idleWarning > 0 ? (
        <div className="idle-warning-overlay" onClick={() => setIdleWarning(0)}>
          <div className="idle-warning-box">
            <p className="idle-warning-title">Sesi akan berakhir dalam</p>
            <div className="idle-warning-number">{idleWarning}</div>
            <p className="idle-warning-hint">Tap di mana saja untuk lanjut</p>
          </div>
        </div>
      ) : null}
    </main>
  );
};

const HiddenVideoCapture = ({ videoRef, stream }: { videoRef: React.RefObject<HTMLVideoElement | null>; stream: MediaStream | null }) => {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    const onLoaded = () => { void video.play().catch(() => {}); };
    video.addEventListener('loadedmetadata', onLoaded);
    if (video.readyState >= 2) { void video.play().catch(() => {}); }
    return () => { video.removeEventListener('loadedmetadata', onLoaded); };
  }, [stream, videoRef]);
  return <video ref={videoRef as React.RefObject<HTMLVideoElement>} autoPlay playsInline muted style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }} />;
};