import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, X, AlertCircle, RotateCcw, Check, Filter as FilterIcon, Image as ImageIcon, ChevronLeft, QrCode, Printer, RefreshCw } from 'lucide-react';
import { useCamera } from './useCamera';
import { CameraPreview, CameraStatusBadge, errorMessages } from './cameraUi';
import { getAspectRatioValue } from './cameraStore';
import { FILTERS, getFilterCss, isGlowFilter, applyGlowToCanvas } from './filters';
import { saveCapture, saveResult, type StoredCapture, type StoredResult } from './storage';
import { generateQrCode, buildResultPayload, buildDriveResultPayload } from './qrService';
import { printResult } from './printService';
import { getOrCreateNextGuestFolder, type GuestRecord } from './guestStore';
import { autoUploadToGuestFolder, retryFailedUploads, type UploadFileEntry } from './uploadService';
import { buildDriveFolderUrl } from './gdriveService';
import type { CameraSettings } from './cameraStore';
import type { Frame, R3aEvent, Slot } from './eventStore';
import type { AllSettings } from './settingsStore';

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

/**
 * Builds a single video file by showing each photo in sequence for `durationPerPhotoMs`,
 * using a hidden canvas as the recording source. Returns a data URL, or null if the
 * browser doesn't support MediaRecorder/canvas.captureStream.
 */
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

  const stream = canvas.captureStream(10);

  return new Promise<string | null>((resolve) => {
    const chunks: Blob[] = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
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

    ctx.drawImage(images[0], 0, 0, width, height);
    recorder.start();

    let i = 1;
    const drawNext = () => {
      if (i < images.length) {
        ctx.drawImage(images[i], 0, 0, width, height);
        i++;
        setTimeout(drawNext, durationPerPhotoMs);
      } else {
        setTimeout(() => recorder.stop(), durationPerPhotoMs);
      }
    };
    setTimeout(drawNext, durationPerPhotoMs);
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

async function compositeFrame(frame: Frame, captures: Map<string, string>, captureFilters: Map<string, string>): Promise<string> {
  const frameImg = frame.image ? await loadImage(frame.image) : null;
  const fw = frameImg?.naturalWidth || 1800;
  const fh = frameImg?.naturalHeight || 1200;
  const canvas = document.createElement('canvas');
  canvas.width = fw;
  canvas.height = fh;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#2a2522';
  ctx.fillRect(0, 0, fw, fh);

  for (const slot of frame.slots) {
    const cap = captures.get(slot.captureId);
    if (!cap) continue;
    try {
      const photo = await loadImage(cap);
      const sx = (slot.x / 100) * fw;
      const sy = (slot.y / 100) * fh;
      const sw = (slot.w / 100) * fw;
      const sh = (slot.h / 100) * fh;
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
      if (glow) {
        applyGlowToCanvas(ctx, photo, sx, sy, sw, sh);
      }
      ctx.restore();
    } catch { /* skip failed slot */ }
  }

  if (frameImg) {
    ctx.drawImage(frameImg, 0, 0, fw, fh);
  }

  return canvas.toDataURL('image/jpeg', 0.95);
}

async function generateSlotPhoto(slot: Slot, captureDataUrl: string, filterId: string, frame: Frame): Promise<string> {
  const frameImg = frame.image ? await loadImage(frame.image) : null;
  const fw = frameImg?.naturalWidth || 1800;
  const fh = frameImg?.naturalHeight || 1200;
  const sx = (slot.x / 100) * fw;
  const sy = (slot.y / 100) * fh;
  const sw = (slot.w / 100) * fw;
  const sh = (slot.h / 100) * fh;

  const photo = await loadImage(captureDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  const ctx = canvas.getContext('2d')!;

  const glow = isGlowFilter(filterId);
  const baseCss = glow ? 'brightness(1.08) saturate(1.15)' : getFilterCss(filterId);

  ctx.save();
  ctx.filter = baseCss;
  drawPhotoCovered(ctx, photo, 0, 0, sw, sh);
  ctx.filter = 'none';
  if (glow) {
    applyGlowToCanvas(ctx, photo, 0, 0, sw, sh);
  }
  ctx.restore();

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

export const PhotoboothSession = ({ event, cameraSettings, allSettings, onExit }: { event: R3aEvent; cameraSettings: CameraSettings; allSettings: AllSettings; onExit: () => void }) => {
  const { stream, status, error } = useCamera(cameraSettings, true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const [phase, setPhase] = useState<SessionPhase>('frame-select');
  const [countdown, setCountdown] = useState(0);
  const [captures, setCaptures] = useState<CaptureData[]>([]);
  const [currentCaptureIndex, setCurrentCaptureIndex] = useState(0);
  const [captureFilters, setCaptureFilters] = useState<Map<string, string>>(new Map());
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [compositeUrl, setCompositeUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [flash, setFlash] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string>('');
  const [printing, setPrinting] = useState(false);
  const [printed, setPrinted] = useState(false);
  const [showAdminExit, setShowAdminExit] = useState(false);
  const [currentGuest, setCurrentGuest] = useState<GuestRecord | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestAssigning, setGuestAssigning] = useState(false);
  const logoClickCount = useRef(0);
  const logoClickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => () => { if (logoClickTimeout.current) clearTimeout(logoClickTimeout.current); }, []);

  useEffect(() => {
    const handleOnline = () => {
      const gd = allSettings.googleDrive;
      if (gd.connected && gd.clientId) {
        void retryFailedUploads(gd.clientId);
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [allSettings.googleDrive]);
  const [captureError, setCaptureError] = useState<CaptureError>(null);
  const [qrError, setQrError] = useState(false);
  const [driveQrDataUrl, setDriveQrDataUrl] = useState<string | null>(null);
  const [driveQrError, setDriveQrError] = useState(false);
  const [frameAspect, setFrameAspect] = useState(3 / 2);
  const [framesReady, setFramesReady] = useState(false);

  const frames = event?.frames ?? [];
  const activeFrame = frames[selectedFrameIndex];
  const allSlots = activeFrame?.slots ?? [];
  const uniqueCaptureIds = useMemo(() => getUniqueCaptureIds(allSlots), [allSlots]);
  const totalCapturesNeeded = uniqueCaptureIds.length;

  useEffect(() => {
    if (!activeFrame?.image) { setFrameAspect(3 / 2); return; }
    const img = new Image();
    img.onload = () => setFrameAspect(img.naturalWidth / img.naturalHeight);
    img.src = activeFrame.image;
  }, [activeFrame?.image]);

  useEffect(() => {
    if (frames.length > 0) {
      setFramesReady(true);
      return;
    }
    setFramesReady(true);
  }, [frames.length]);

  const videoRefCallback = useCallback((el: HTMLVideoElement | null) => {
    (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
  }, []);

  const resetSession = useCallback(() => {
    setFlash(false);
    setCaptures([]);
    setCurrentCaptureIndex(0);
    setCaptureFilters(new Map());
    setSelectedCaptureId(null);
    setCompositeUrl(null);
    setSaved(false);
    setQrDataUrl(null);
    setResultId('');
    setPrinted(false);
    setPrinting(false);
    setCaptureError(null);
    setQrError(false);
    setDriveQrDataUrl(null);
    setDriveQrError(false);
  }, []);

  const handleSelectFrame = useCallback((index: number) => {
    setSelectedFrameIndex(index);
    resetSession();
    setPhase('ready');
  }, [resetSession]);

  const handleStartCapture = useCallback(async () => {
    resetSession();
    setGuestError(null);

    const gd = allSettings.googleDrive;
    if (gd.connected && gd.clientId && gd.mainFolderId) {
      setGuestAssigning(true);
      const result = await getOrCreateNextGuestFolder(event.id, gd.mainFolderId, gd.clientId);
      setGuestAssigning(false);
      if (result.success && result.guest) {
        setCurrentGuest(result.guest);
      } else {
        setGuestError(result.error || 'Failed to create guest folder');
      }
    }

    setPhase('live');
  }, [resetSession, allSettings.googleDrive, event.id]);

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
      preFlashTimer = setTimeout(() => {
        setFlash(true);
      }, 700);
    }
    const timer = setTimeout(() => {
      if (countdown <= 1) {
        const video = videoRef.current;
        if (video && isVideoReady(video)) {
          const dataUrl = captureFromVideo(video, cameraSettings.mirror);
          const capId = uniqueCaptureIds[currentCaptureIndex];
          const newCapture: CaptureData = { captureId: capId, dataUrl };
          setCaptures((prev) => [...prev, newCapture]);
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
        if (currentCaptureIndex + 1 >= totalCapturesNeeded) {
          setSelectedCaptureId(uniqueCaptureIds[0] ?? null);
          setPhase('filter');
        } else {
          setCurrentCaptureIndex((i) => i + 1);
          setPhase('live');
        }
        setCountdown(0);
      } else {
        setCountdown((c) => c - 1);
      }
    }, 1000);
    return () => { clearTimeout(timer); if (preFlashTimer) clearTimeout(preFlashTimer); };
  }, [phase, countdown, currentCaptureIndex, totalCapturesNeeded, uniqueCaptureIds, cameraSettings.mirror, event.id, isVideoReady]);

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
    for (const c of captures) {
      captureMap.set(c.captureId, c.dataUrl);
    }
    try {
      const result = await compositeFrame(activeFrame, captureMap, captureFilters);
      setCompositeUrl(result);
      setPhase('result');
    } catch {
      setPhase('filter');
    }
  }, [activeFrame, captures, captureFilters]);

  const handleSave = useCallback(async () => {
    if (!compositeUrl || !activeFrame) return;
    try {
      const id = `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result: StoredResult = {
        id,
        eventId: event.id,
        frameId: activeFrame.id,
        dataUrl: compositeUrl,
        filterId: 'multi',
        createdAt: Date.now(),
      };
      await saveResult(result);
      setResultId(id);
      setSaved(true);

      const captureMap = new Map(captures.map((c) => [c.captureId, c.dataUrl]));
      const slotPhotos: { index: number; dataUrl: string }[] = [];
      for (let i = 0; i < allSlots.length; i++) {
        const slot = allSlots[i];
        const cap = captureMap.get(slot.captureId);
        if (!cap) continue;
        try {
          const slotDataUrl = await generateSlotPhoto(slot, cap, captureFilters.get(slot.captureId) || 'natural', activeFrame);
          slotPhotos.push({ index: i + 1, dataUrl: slotDataUrl });
        } catch { /* skip failed slot */ }
      }

      let slideshowVideo: string | null = null;
      if (allSettings.storage.saveVideos && slotPhotos.length > 0) {
        try {
          const ordered = [...slotPhotos].sort((a, b) => a.index - b.index);
          slideshowVideo = await generateSlideshowVideo(ordered, 1000);
        } catch {
          slideshowVideo = null;
        }
      }

      if (allSettings.storage.autoDownloadResult) {
        for (const sp of slotPhotos) {
          const slotName = `slot-${String(sp.index).padStart(2, '0')}.jpg`;
          downloadDataUrl(sp.dataUrl, slotName);
        }
        if (slideshowVideo) {
          downloadDataUrl(slideshowVideo, `video.${guessVideoExtension(slideshowVideo)}`);
        }
        downloadDataUrl(compositeUrl, 'final-result.jpg');
      }

      const gd = allSettings.googleDrive;
      if (gd.connected && gd.clientId && currentGuest) {
        const uploadFiles: UploadFileEntry[] = [
          { fileName: 'final.jpg', dataUrl: compositeUrl },
          ...slotPhotos.map((sp) => ({
            fileName: `slot-${String(sp.index).padStart(2, '0')}.jpg`,
            dataUrl: sp.dataUrl,
          })),
          ...(slideshowVideo
            ? [{ fileName: `video.${guessVideoExtension(slideshowVideo)}`, dataUrl: slideshowVideo }]
            : []),
        ];
        void autoUploadToGuestFolder(currentGuest, gd.clientId, uploadFiles);
      }
    } catch { /* ignore */ }
  }, [compositeUrl, activeFrame, event.id, allSettings, allSlots, captures, captureFilters, currentGuest]);

  const handleShowQr = useCallback(async () => {
    if (!currentGuest) return;
    setQrError(false);
    setQrDataUrl(null);
    setPhase('qr');
    const payload = buildDriveResultPayload(currentGuest.guestFolderId, event.name);
    try {
      const qr = await generateQrCode(payload);
      if (qr.qrDataUrl) {
        setQrDataUrl(qr.qrDataUrl);
      } else {
        setQrError(true);
      }
    } catch {
      setQrError(true);
    }
  }, [currentGuest, event.name]);

  const handleShowDriveQr = useCallback(async () => {
    if (!currentGuest) return;
    setDriveQrError(false);
    setDriveQrDataUrl(null);
    setPhase('drive-qr');
    try {
      const url = buildDriveFolderUrl(currentGuest.guestFolderId);
      const qr = await generateQrCode(url);
      if (qr.qrDataUrl) {
        setDriveQrDataUrl(qr.qrDataUrl);
      } else {
        setDriveQrError(true);
      }
    } catch {
      setDriveQrError(true);
    }
  }, [currentGuest]);

  const handlePrint = useCallback(async () => {
    if (!compositeUrl || printing) return;
    setPrinting(true);
    try {
      const copies = event.printerSettings.copies || 1;
      await printResult({ copies, paperSize: event.printerSettings.paperSize, dataUrl: compositeUrl, printerName: allSettings.printer.printer });
      setPrinted(true);
    } catch { /* ignore */ }
    setPrinting(false);
  }, [compositeUrl, printing, event.printerSettings, allSettings.printer.printer]);

  const handleBackToFrameSelect = useCallback(() => {
    resetSession();
    setCurrentGuest(null);
    setGuestError(null);
    setPhase('frame-select');
  }, [resetSession]);

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

  const captureMap = new Map(captures.map((c) => [c.captureId, c.dataUrl]));

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
              {frames.map((frame, i) => (
                <button key={frame.id} className="frame-select-card" onClick={() => handleSelectFrame(i)} type="button">
                  <div className="frame-select-thumb" style={frame.image ? { background: `url(${frame.image}) center/contain no-repeat #2a2522` } : undefined}>
                    {!frame.image ? <ImageIcon size={32} strokeWidth={1} /> : null}
                  </div>
                  <div className="frame-select-info">
                    <strong>{frame.name}</strong>
                    <span>{frame.slots.length} SLOTS</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    );
  }

  if (phase === 'ready') {
    return (
      <main className="photobooth-screen photobooth-kiosk">
        <div className="photobooth-kiosk-header">
          <div className="photobooth-project" onClick={handleLogoClick}><span>R3A BOOTH</span><strong>{event.eventName || 'Untitled Event'}</strong></div>
          <button className="photobooth-exit" onClick={handleBackToFrameSelect} type="button"><X size={24} /> BACK</button>
        </div>
        <section className="ready-section">
          <div className="ready-frame-preview" style={{ aspectRatio: frameAspect }}>
            {activeFrame?.image ? (
              <img src={activeFrame.image} alt={activeFrame.name} />
            ) : (
              <div className="ready-frame-placeholder"><ImageIcon size={48} strokeWidth={1} /></div>
            )}
            {allSlots.map((slot) => (
              <div key={slot.id} className="ready-slot-outline" style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}>
                <span>{slot.captureId}</span>
              </div>
            ))}
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
      {flash ? <div className="capture-flash" /> : null}

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
                <div className="photobooth-video-wrap" style={{ aspectRatio: String(getAspectRatioValue(cameraSettings.aspectRatio)) }}>
                  <CameraPreview stream={stream} mirror={cameraSettings.mirror} aspectRatio={cameraSettings.aspectRatio} className="photobooth-video" />
                  {phase === 'countdown' ? (
                    <div className="countdown-overlay">
                      <span className="countdown-number">{countdown}</span>
                    </div>
                  ) : null}
                </div>
                <HiddenVideoCapture videoRef={videoRef} stream={stream} />
              </>
            ) : (
              <div className="photobooth-preview">
                {status === 'error' ? (
                  <>
                    <AlertCircle size={48} strokeWidth={1} />
                    <span>CAMERA ERROR</span>
                    <em>{error ? errorMessages[error] : 'Unable to start camera.'}</em>
                  </>
                ) : (
                  <>
                    <Camera size={64} strokeWidth={1} />
                    <span>{status === 'connecting' ? 'CONNECTING CAMERA...' : 'CAMERA PREVIEW'}</span>
                    <em>{status === 'connecting' ? 'Starting camera stream...' : 'Camera not connected.'}</em>
                  </>
                )}
              </div>
            )}
          </section>
          <div className="photobooth-controls">
            <div className="photobooth-camera-status"><CameraStatusBadge status={status} error={error} /></div>
            <div className="photobooth-capture-info">
              <span>PHOTO {currentCaptureIndex + 1} / {totalCapturesNeeded}</span>
            </div>
            <button className="photobooth-capture" type="button" disabled={!stream || phase === 'countdown' || totalCapturesNeeded === 0} onClick={handleCapture}>
              <Camera size={32} /> {phase === 'countdown' ? 'CAPTURING...' : 'CAPTURE'}
            </button>
          </div>
          {captureError ? (
            <div className="photobooth-capture-error"><AlertCircle size={20} /> {captureError.message}</div>
          ) : null}
          {guestError ? (
            <div className="photobooth-capture-error"><AlertCircle size={20} /> GUEST FOLDER: {guestError}</div>
          ) : null}
          <div className="photobooth-slots">
            {allSlots.length === 0 ? <p className="photobooth-no-slots">No slots configured for this frame.</p> : null}
            {allSlots.map((slot, i) => {
              const filled = captureMap.has(slot.captureId);
              const isNext = !filled && uniqueCaptureIds.indexOf(slot.captureId) === currentCaptureIndex;
              return (
                <div key={slot.id} className={`photobooth-slot ${filled ? 'filled' : ''} ${isNext ? 'active' : ''}`}>
                  {filled ? (
                    <img src={captureMap.get(slot.captureId)} alt={slot.captureId} style={{ objectFit: 'cover' }} />
                  ) : (
                    <span>{slot.captureId}</span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {phase === 'filter' ? (
        <section className="photobooth-filter-section">
          <div className="filter-header">
            <h2>SELECT FILTER</h2>
            <p>Select a photo, then choose a filter. Each photo can have a different filter.</p>
          </div>
          <div className="filter-preview-area">
            <div className="filter-preview-frame" style={{ ['--frame-aspect' as string]: String(frameAspect), aspectRatio: String(frameAspect) }}>
              {activeFrame?.image ? (
                <img src={activeFrame.image} alt={activeFrame.name} className="filter-preview-frame-img" />
              ) : (
                <div className="filter-preview-empty">No frame image</div>
              )}
              {allSlots.map((slot) => {
                const cap = captureMap.get(slot.captureId);
                if (!cap) return null;
                const filterId = captureFilters.get(slot.captureId) || 'natural';
                const isSelected = selectedCaptureId === slot.captureId;
                return (
                  <div
                    key={slot.id}
                    className={`filter-preview-slot ${isSelected ? 'is-selected' : ''}`}
                    style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` }}
                    onClick={() => setSelectedCaptureId(slot.captureId)}
                  >
                    <img src={cap} alt={slot.captureId} style={{ filter: getFilterCss(filterId), objectFit: 'cover' }} />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="filter-slot-selector">
            {uniqueCaptureIds.map((capId) => {
              const cap = captureMap.get(capId);
              if (!cap) return null;
              const filterId = captureFilters.get(capId) || 'natural';
              const isSelected = selectedCaptureId === capId;
              return (
                <button
                  key={capId}
                  className={`filter-slot-thumb ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => setSelectedCaptureId(capId)}
                  type="button"
                >
                  <img src={cap} alt={capId} style={{ filter: getFilterCss(filterId), objectFit: 'cover' }} />
                  <span>{capId}</span>
                  {filterId !== 'natural' ? <em className="filter-badge">{filterId.toUpperCase()}</em> : null}
                </button>
              );
            })}
          </div>
          {selectedCaptureId ? (
            <div className="filter-options">
              {FILTERS.map((f) => {
                const currentFilter = captureFilters.get(selectedCaptureId) || 'natural';
                return (
                  <button
                    key={f.id}
                    className={currentFilter === f.id ? 'is-active' : ''}
                    onClick={() => {
                      setCaptureFilters((prev) => {
                        const next = new Map(prev);
                        next.set(selectedCaptureId, f.id);
                        return next;
                      });
                    }}
                    type="button"
                  >
                    <span className="filter-thumb" style={{ filter: f.css }}><FilterIcon size={16} /></span>
                    {f.name}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="filter-actions">
            <button className="filter-back" onClick={() => { resetSession(); setPhase('live'); }} type="button"><RotateCcw size={18} /> RETAKE</button>
            <button className="filter-compose" onClick={handleComposite} type="button"><ImageIcon size={18} /> COMPOSITE &amp; PREVIEW</button>
          </div>
        </section>
      ) : null}

      {phase === 'compositing' ? (
        <section className="photobooth-compositing">
          <div className="compositing-spinner" />
          <span>COMPOSITING...</span>
        </section>
      ) : null}

      {phase === 'result' && compositeUrl ? (
        <section className="photobooth-result-section">
          <div className="result-header">
            <h2>YOUR PHOTO IS READY</h2>
          </div>
          <div className="result-preview">
            <img src={compositeUrl} alt="Final result" />
          </div>
          <div className="result-actions">
            <button className="result-retake" onClick={() => { resetSession(); setPhase('live'); }} type="button"><RotateCcw size={18} /> RETAKE</button>
            <button className="result-save" onClick={handleSave} disabled={saved} type="button">
              {saved ? <><Check size={18} /> SAVED</> : <><Check size={18} /> SAVE</>}
            </button>
            {allSettings.display.showPrintButton ? (
              <button className="result-print" onClick={handlePrint} disabled={!saved || printing || printed} type="button">
                <Printer size={18} /> {printing ? 'PRINTING...' : printed ? 'PRINTED' : 'PRINT'}
              </button>
            ) : null}
            {allSettings.display.showQrButton ? (
              <button className="result-qr" onClick={handleShowQr} disabled={!saved} type="button">
                <QrCode size={18} /> QR CODE
              </button>
            ) : null}
            {currentGuest && allSettings.display.showDriveQrButton ? (
              <button className="result-qr" onClick={handleShowDriveQr} disabled={!saved} type="button">
                <QrCode size={18} /> DRIVE QR
              </button>
            ) : null}
          </div>
          <button className="result-new-session" onClick={handleBackToFrameSelect} type="button">
            <RefreshCw size={18} /> NEW SESSION
          </button>
        </section>
      ) : null}

      {phase === 'qr' ? (
        <section className="photobooth-qr-section">
          <div className="qr-header">
            <h2>SCAN TO VIEW</h2>
            <p>Scan this QR code with your phone to view your photo</p>
          </div>
          <div className="qr-display">
            {qrError ? (
              <div className="qr-error-state">
                <AlertCircle size={48} strokeWidth={1} />
                <span>QR GENERATION FAILED</span>
                <button type="button" onClick={handleShowQr} className="qr-retry">RETRY</button>
              </div>
            ) : qrDataUrl ? (
              <img src={qrDataUrl} alt="QR Code" />
            ) : (
              <div className="qr-loading"><div className="compositing-spinner" /></div>
            )}
          </div>
          <div className="qr-actions">
            <button className="qr-back-result" onClick={() => setPhase('result')} type="button"><ChevronLeft size={18} /> BACK</button>
            <button className="qr-new-session" onClick={handleBackToFrameSelect} type="button"><RefreshCw size={18} /> NEW SESSION</button>
          </div>
        </section>
      ) : null}

      {phase === 'drive-qr' ? (
        <section className="photobooth-qr-section">
          <div className="qr-header">
            <h2>SCAN TO GET YOUR PHOTOS</h2>
            <p>Scan untuk mengambil foto</p>
          </div>
          <div className="qr-display">
            {driveQrError ? (
              <div className="qr-error-state">
                <AlertCircle size={48} strokeWidth={1} />
                <span>QR GENERATION FAILED</span>
                <button type="button" onClick={handleShowDriveQr} className="qr-retry">RETRY</button>
              </div>
            ) : driveQrDataUrl ? (
              <img src={driveQrDataUrl} alt="Google Drive QR Code" />
            ) : (
              <div className="qr-loading"><div className="compositing-spinner" /></div>
            )}
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
