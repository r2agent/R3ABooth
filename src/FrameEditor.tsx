import { useRef, useState, useCallback, useEffect, useLayoutEffect, type CSSProperties } from 'react';
import { Copy, Plus, Trash2, Upload, X, Lock, Unlock, RotateCcw, Check, Eye, EyeOff, ZoomIn, ZoomOut } from 'lucide-react';
import { createSlot, duplicateSlot } from './eventStore';
import { loadCameraSettings, getAspectRatioValue } from './cameraStore';
import type { Frame, Slot } from './eventStore';

type DragState = {
  slotId: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
};

export const FrameEditor = ({
  frame,
  onSlotsChange,
  onAddSlot,
  onDuplicateSlot,
  onDeleteSlot,
  onUploadImage,
  onUploadSlotFrame,
  onSlotFrameChange,
  onFrameChange,
  onApplyTransformToAll,
}: {
  frame: Frame;
  onSlotsChange: (slots: Slot[]) => void;
  onAddSlot: (captureId: string, w: number, h: number) => void;
  onDuplicateSlot: (slot: Slot) => void;
  onDeleteSlot: (slotId: string) => void;
  onUploadImage: (file: File) => void;
  onUploadSlotFrame: (file: File) => void;
  onSlotFrameChange: (dataUrl: string) => void;
  onFrameChange: (updates: Partial<Frame>) => void;
  onApplyTransformToAll: () => void;
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [frameAspect, setFrameAspect] = useState(3 / 2);
  const [cameraAspect, setCameraAspect] = useState(16 / 9);
  const [ratioLocked, setRatioLocked] = useState(true);

  useEffect(() => {
    if (!frame.image) { setFrameAspect(3 / 2); return; }
    const img = new Image();
    img.onload = () => setFrameAspect(img.naturalWidth / img.naturalHeight);
    img.src = frame.image;
  }, [frame.image]);

  useEffect(() => {
    try {
      const cam = loadCameraSettings();
      setCameraAspect(getAspectRatioValue(cam.aspectRatio));
    } catch { /* keep default */ }
  }, []);

  const selectedSlot = frame.slots.find((s) => s.id === selectedSlotId) ?? null;

  const photoOffsetX = frame.photoOffsetX ?? 0;
  const photoOffsetY = frame.photoOffsetY ?? 0;
  const photoScale = frame.photoScale ?? 1;
  const photoRotation = frame.photoRotation ?? 0;

  const setPhotoTransform = (updates: Partial<Frame>) => {
    onFrameChange({
      photoOffsetX: updates.photoOffsetX ?? photoOffsetX,
      photoOffsetY: updates.photoOffsetY ?? photoOffsetY,
      photoScale: updates.photoScale ?? photoScale,
      photoRotation: updates.photoRotation ?? photoRotation,
    });
  };

  // ---- Zoom & pan canvas ----
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 5;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const [fitSize, setFitSize] = useState<{ w: number; h: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const zoomAnchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);
  const panMoved = useRef(false);
  const pointerInStage = useRef(false);

  // Ukuran "fit" = canvas muat penuh di area yang tersedia (zoom 100%)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const calc = () => {
      const cs = getComputedStyle(el);
      const availW = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const availH = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (availW <= 0 || availH <= 0) return;
      const w = Math.floor(Math.min(availW, availH * frameAspect, 900));
      setFitSize({ w, h: Math.floor(w / frameAspect) });
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [frameAspect]);

  // Zoom mengarah ke titik kursor (atau tengah area kalau lewat tombol)
  const applyZoom = useCallback((next: number, cx?: number, cy?: number) => {
    const sc = scrollRef.current;
    const cv = editorRef.current;
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100));
    if (sc && cv) {
      const s = sc.getBoundingClientRect();
      const c = cv.getBoundingClientRect();
      const px = cx ?? s.left + sc.clientWidth / 2;
      const py = cy ?? s.top + sc.clientHeight / 2;
      zoomAnchor.current = { fx: (px - c.left) / c.width, fy: (py - c.top) / c.height, cx: px, cy: py };
    }
    setZoom(clamped);
  }, []);

  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    zoomAnchor.current = null;
    const sc = scrollRef.current;
    const cv = editorRef.current;
    if (!a || !sc || !cv) return;
    const c = cv.getBoundingClientRect();
    sc.scrollLeft += c.left + a.fx * c.width - a.cx;
    sc.scrollTop += c.top + a.fy * c.height - a.cy;
  }, [zoom]);

  // Ctrl/Cmd + scroll = zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      applyZoom(zoomRef.current * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  // Tahan Space = mode geser (pan)
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && pointerInStage.current && !isTyping(e.target)) { e.preventDefault(); setSpaceDown(true); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false); };
    const blur = () => setSpaceDown(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Ganti frame -> kembali ke fit
  useEffect(() => { setZoom(1); }, [frame.id]);

  const handlePanStart = (e: React.MouseEvent) => {
    if (!(e.button === 1 || (e.button === 0 && spaceDown))) return;
    const sc = scrollRef.current;
    if (!sc) return;
    e.preventDefault();
    e.stopPropagation();
    panMoved.current = false;
    setPanning(true);
    const sx = e.clientX, sy = e.clientY, sl = sc.scrollLeft, st = sc.scrollTop;
    const move = (ev: MouseEvent) => {
      panMoved.current = true;
      sc.scrollLeft = sl - (ev.clientX - sx);
      sc.scrollTop = st - (ev.clientY - sy);
    };
    const up = () => {
      setPanning(false);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const resetPhotoTransform = () => {
    onFrameChange({ photoOffsetX: 0, photoOffsetY: 0, photoScale: 1, photoRotation: 0 });
  };

  const getRectPct = useCallback(() => {
    const el = editorRef.current;
    if (!el) return { w: 1, h: 1 };
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }, []);

  const handleMouseDown = (e: React.MouseEvent, slot: Slot, mode: 'move' | 'resize') => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedSlotId(slot.id);
    setDrag({ slotId: slot.id, mode, startX: e.clientX, startY: e.clientY, origX: slot.x, origY: slot.y, origW: slot.w, origH: slot.h });
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drag) return;
    const { w: rectW, h: rectH } = getRectPct();
    const dxPct = ((e.clientX - drag.startX) / rectW) * 100;
    const dyPct = ((e.clientY - drag.startY) / rectH) * 100;

    onSlotsChange(frame.slots.map((s) => {
      if (s.id !== drag.slotId) return s;

      if (drag.mode === 'move') {
        return {
          ...s,
          x: Math.max(0, Math.min(100 - s.w, drag.origX + dxPct)),
          y: Math.max(0, Math.min(100 - s.h, drag.origY + dyPct)),
        };
      }

      const slotAspect = drag.origW / drag.origH;
      let proposedW: number;
      let proposedH: number;

      if (ratioLocked) {
        const useWidth = Math.abs(dxPct) >= Math.abs(dyPct);
        if (useWidth) {
          proposedW = drag.origW + dxPct;
          proposedH = proposedW / slotAspect;
        } else {
          proposedH = drag.origH + dyPct;
          proposedW = proposedH * slotAspect;
        }
        if (proposedW < 5) { proposedW = 5; proposedH = proposedW / slotAspect; }
        if (proposedH < 5) { proposedH = 5; proposedW = proposedH * slotAspect; }
        const maxW = 100 - s.x;
        const maxH = 100 - s.y;
        if (proposedW > maxW) { proposedW = maxW; proposedH = proposedW / slotAspect; }
        if (proposedH > maxH) { proposedH = maxH; proposedW = proposedH * slotAspect; }
      } else {
        proposedW = Math.max(5, drag.origW + dxPct);
        proposedH = Math.max(5, drag.origH + dyPct);
        const maxW = 100 - s.x;
        const maxH = 100 - s.y;
        proposedW = Math.min(maxW, proposedW);
        proposedH = Math.min(maxH, proposedH);
      }

      return { ...s, w: proposedW, h: proposedH };
    }));
  }, [drag, frame.slots, ratioLocked, getRectPct, onSlotsChange]);

  const handleMouseUp = useCallback(() => setDrag(null), []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.match(/^image\/(png|jpeg)$/)) return;
    onUploadImage(file);
    e.target.value = '';
  };

  const handleSlotFrameUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.match(/^image\/(png|jpeg)$/)) return;
    onUploadSlotFrame(file);
    e.target.value = '';
  };

  const handleAddSlot = () => {
    const captureId = `cap-${frame.slots.length + 1}`;
    const canvasAspect = frameAspect || 1;
    const slotAspectPct = cameraAspect / canvasAspect;
    let w = 40;
    let h = w / slotAspectPct;
    if (h > 60) { h = 60; w = h * slotAspectPct; }
    if (w > 80) { w = 80; h = w / slotAspectPct; }
    onAddSlot(captureId, w, h);
  };

  const sliderStyle: React.CSSProperties = {
    width: '100%',
    accentColor: '#ffd94e',
  };

  const showPhotoCount = frame.showPhotoCount !== false;

  return (
    <div className="frame-editor">
      <div className="frame-editor-toolbar" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Nama Frame */}
        <input
          type="text"
          placeholder="Nama frame (opsional)"
          value={frame.name || ''}
          onChange={(e) => onFrameChange({ name: e.target.value })}
          maxLength={40}
          style={{
            height: 42,
            padding: '0 14px',
            minWidth: 200,
            border: '1px solid rgba(255,255,255,.25)',
            background: 'rgba(255,255,255,.06)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            outline: 'none',
          }}
        />

        {/* Toggle Photo Count */}
        <button
          type="button"
          onClick={() => onFrameChange({ showPhotoCount: !showPhotoCount })}
          title="Tampilkan badge jumlah foto di frame select"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 42,
            padding: '0 14px',
            border: showPhotoCount ? '1px solid rgba(255,217,78,.5)' : '1px solid rgba(255,255,255,.25)',
            color: showPhotoCount ? '#ffd94e' : 'rgba(255,255,255,.5)',
            background: showPhotoCount ? 'rgba(255,217,78,.1)' : 'rgba(255,255,255,.06)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '.06em',
            cursor: 'pointer',
          }}
        >
          {showPhotoCount ? <Eye size={14} /> : <EyeOff size={14} />}
          COUNT
        </button>

        <button type="button" onClick={handleAddSlot}><Plus size={16} /> ADD SLOT</button>
        {selectedSlotId ? <button type="button" onClick={() => { const s = frame.slots.find((sl) => sl.id === selectedSlotId); if (s) onDuplicateSlot(s); }}><Copy size={16} /> DUPLICATE</button> : null}
        {selectedSlotId ? <button type="button" onClick={() => { onDeleteSlot(selectedSlotId); setSelectedSlotId(null); }}><Trash2 size={16} /> DELETE</button> : null}
        <label className="frame-upload-label">
          <Upload size={16} /> UPLOAD FRAME IMAGE
          <input type="file" accept="image/png,image/jpeg" onChange={handleFileUpload} hidden />
        </label>
        <label className="frame-upload-label" style={{ borderColor: '#ffd94e', color: '#ffd94e' }}>
          <Upload size={16} /> UPLOAD WATERMARK
          <input type="file" accept="image/png,image/jpeg" onChange={handleSlotFrameUpload} hidden />
        </label>

        <button
          type="button"
          onClick={resetPhotoTransform}
          title="Reset transform foto"
          style={{ borderColor: 'rgba(255,255,255,.3)', color: 'rgba(255,255,255,.8)' }}
        >
          <RotateCcw size={16} /> RESET
        </button>
        <button
          type="button"
          onClick={onApplyTransformToAll}
          title="Apply transform ke semua frame"
          style={{ borderColor: 'rgba(74,222,128,.6)', color: '#4ade80' }}
        >
          <Check size={16} /> APPLY ALL
        </button>
      </div>

      <div className="frame-editor-body">
        <div
          className="frame-editor-stage"
          onMouseEnter={() => { pointerInStage.current = true; }}
          onMouseLeave={() => { pointerInStage.current = false; }}
        >
        <div className="frame-editor-zoom" title="Ctrl + scroll: zoom • Space + drag / klik tengah mouse: geser">
          <button type="button" onClick={() => applyZoom(zoomRef.current / 1.25)} disabled={zoom <= MIN_ZOOM} title="Zoom out"><ZoomOut size={14} /></button>
          <button type="button" className="frame-editor-zoom-value" onClick={() => applyZoom(1)} title="Reset ke ukuran fit">{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={() => applyZoom(zoomRef.current * 1.25)} disabled={zoom >= MAX_ZOOM} title="Zoom in"><ZoomIn size={14} /></button>
          <button type="button" onClick={() => applyZoom(1)} disabled={zoom === 1} title="Fit ke layar">FIT</button>
        </div>
        <div
          ref={scrollRef}
          className={`frame-editor-scroll${spaceDown ? ' is-pan-ready' : ''}${panning ? ' is-panning' : ''}`}
          onMouseDownCapture={handlePanStart}
        >
          <div
            ref={editorRef}
            className="frame-editor-canvas"
            style={{
              aspectRatio: frameAspect,
              ...(fitSize ? { width: fitSize.w * zoom, height: fitSize.h * zoom, maxWidth: 'none', maxHeight: 'none', flex: 'none' } : {}),
            }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={() => { if (panMoved.current) { panMoved.current = false; return; } setSelectedSlotId(null); }}
          >
            {frame.image ? (
              <img src={frame.image} alt={frame.name} className="frame-editor-bg" draggable={false} />
            ) : (
              <div className="frame-editor-placeholder"><span>No frame image uploaded</span></div>
            )}
            {frame.slots.map((slot) => (
              <div
                key={slot.id}
                className={`frame-slot ${selectedSlotId === slot.id ? 'is-selected' : ''}`}
                style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.w}%`, height: `${slot.h}%` } as CSSProperties}
                onMouseDown={(e) => handleMouseDown(e, slot, 'move')}
                onClick={(e) => { e.stopPropagation(); setSelectedSlotId(slot.id); }}
              >
                <span className="frame-slot-label">{slot.captureId}</span>
                <div className="frame-slot-resize" onMouseDown={(e) => handleMouseDown(e, slot, 'resize')} />
              </div>
            ))}
          </div>
        </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            alignSelf: 'stretch',
            height: '100%',
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            paddingRight: 4,
            scrollbarWidth: 'thin',
          }}
        >
          {selectedSlot ? (
            <div className="frame-slot-inspector" style={{ padding: 10 }}>
              <div className="inspector-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingBottom: 6 }}>
                <span>SLOT INSPECTOR</span>
                <button
                  type="button"
                  onClick={() => setRatioLocked((v) => !v)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '2px 6px', fontSize: 9, fontWeight: 700, letterSpacing: '.06em',
                    background: ratioLocked ? 'rgba(255,217,78,.15)' : 'rgba(255,255,255,.08)',
                    border: ratioLocked ? '1px solid rgba(255,217,78,.5)' : '1px solid rgba(255,255,255,.2)',
                    color: ratioLocked ? '#ffd94e' : 'rgba(255,255,255,.6)',
                    cursor: 'pointer',
                  }}
                >
                  {ratioLocked ? <Lock size={9} /> : <Unlock size={9} />}
                  {ratioLocked ? 'LOCKED' : 'UNLOCKED'}
                </button>
              </div>
              <div className="inspector-row" style={{ fontSize: 11 }}><span>CAPTURE ID</span><strong>{selectedSlot.captureId}</strong></div>
              <div className="inspector-row" style={{ fontSize: 11 }}><span>X / Y</span><strong>{Math.round(selectedSlot.x)}% / {Math.round(selectedSlot.y)}%</strong></div>
              <div className="inspector-row" style={{ fontSize: 11 }}><span>W / H</span><strong>{Math.round(selectedSlot.w)}% / {Math.round(selectedSlot.h)}%</strong></div>
            </div>
          ) : (
            <div className="frame-slot-inspector frame-slot-inspector-empty" style={{ padding: 10 }}>
              <div className="inspector-header" style={{ paddingBottom: 6 }}>SLOT INSPECTOR</div>
              <p style={{ margin: 0, fontSize: 11 }}>Select a slot to view its position and size.</p>
            </div>
          )}

          <div className="frame-slot-inspector" style={{ padding: 10 }}>
            <div className="inspector-header" style={{ paddingBottom: 6 }}>PHOTO TRANSFORM</div>

            <div
              style={{
                width: '100%',
                aspectRatio: '16 / 9',
                background: 'repeating-conic-gradient(#2a2522 0% 25%, #1a1614 0% 50%) 50% / 16px 16px',
                border: '1px solid rgba(255,255,255,.15)',
                overflow: 'hidden',
                position: 'relative',
                marginTop: 4,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  transform: `translate(${photoOffsetX}%, ${photoOffsetY}%) scale(${photoScale}) rotate(${photoRotation}deg)`,
                  transformOrigin: 'center center',
                  background: 'repeating-linear-gradient(45deg, #ef3f25, #ef3f25 10px, #c92f1d 10px, #c92f1d 20px)',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: '.15em',
                  textShadow: '0 2px 4px rgba(0,0,0,.5)',
                  zIndex: 1,
                }}
              >
                FOTO
              </div>
              {frame.slotFrameImage ? (
                <img
                  src={frame.slotFrameImage}
                  alt="Watermark overlay"
                  style={{
                    position: 'absolute', inset: 0,
                    width: '100%', height: '100%',
                    objectFit: 'fill',
                    pointerEvents: 'none',
                    zIndex: 2,
                  }}
                />
              ) : null}
            </div>

            {frame.slotFrameImage ? (
              <button
                type="button"
                onClick={() => onSlotFrameChange('')}
                style={{
                  marginTop: 6, width: '100%', padding: '5px 8px',
                  background: 'transparent',
                  border: '1px solid rgba(239,63,37,.5)',
                  color: '#ef3f25', fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                }}
              >
                <X size={11} /> HAPUS WATERMARK
              </button>
            ) : null}

            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,.6)', marginBottom: 2 }}>
                  <span>OFFSET X</span><strong style={{ color: '#ffd94e' }}>{photoOffsetX.toFixed(0)}%</strong>
                </div>
                <input type="range" min={-50} max={50} step={1} value={photoOffsetX}
                  onChange={(e) => setPhotoTransform({ photoOffsetX: parseInt(e.target.value, 10) })}
                  style={sliderStyle} />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,.6)', marginBottom: 2 }}>
                  <span>OFFSET Y</span><strong style={{ color: '#ffd94e' }}>{photoOffsetY.toFixed(0)}%</strong>
                </div>
                <input type="range" min={-50} max={50} step={1} value={photoOffsetY}
                  onChange={(e) => setPhotoTransform({ photoOffsetY: parseInt(e.target.value, 10) })}
                  style={sliderStyle} />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,.6)', marginBottom: 2 }}>
                  <span>SCALE</span><strong style={{ color: '#ffd94e' }}>{photoScale.toFixed(2)}x</strong>
                </div>
                <input type="range" min={0.5} max={2} step={0.05} value={photoScale}
                  onChange={(e) => setPhotoTransform({ photoScale: parseFloat(e.target.value) })}
                  style={sliderStyle} />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,.6)', marginBottom: 2 }}>
                  <span>ROTATION</span><strong style={{ color: '#ffd94e' }}>{photoRotation.toFixed(0)}°</strong>
                </div>
                <input type="range" min={-180} max={180} step={1} value={photoRotation}
                  onChange={(e) => setPhotoTransform({ photoRotation: parseInt(e.target.value, 10) })}
                  style={sliderStyle} />
              </div>
            </div>
          </div>
        </div>
      </div>
      {frame.slots.length === 0 ? <p className="frame-editor-empty">No slots yet. Add a slot to define where captured photos appear on the frame.</p> : null}
    </div>
  );
};
