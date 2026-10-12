import { useRef, useState, useCallback, useEffect, type CSSProperties } from 'react';
import { Copy, Plus, Trash2, Upload, X, Lock, Unlock, RotateCcw } from 'lucide-react';
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

  return (
    <div className="frame-editor">
      <div className="frame-editor-toolbar">
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
      </div>
      <div className="frame-editor-body">
        <div className="frame-editor-scroll">
        <div
          ref={editorRef}
          className="frame-editor-canvas"
          style={{ aspectRatio: frameAspect }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={() => setSelectedSlotId(null)}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignSelf: 'start' }}>
          {selectedSlot ? (
            <div className="frame-slot-inspector">
              <div className="inspector-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span>SLOT INSPECTOR</span>
                <button
                  type="button"
                  onClick={() => setRatioLocked((v) => !v)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
                    background: ratioLocked ? 'rgba(255,217,78,.15)' : 'rgba(255,255,255,.08)',
                    border: ratioLocked ? '1px solid rgba(255,217,78,.5)' : '1px solid rgba(255,255,255,.2)',
                    color: ratioLocked ? '#ffd94e' : 'rgba(255,255,255,.6)',
                    cursor: 'pointer', transition: '.18s',
                  }}
                >
                  {ratioLocked ? <Lock size={10} /> : <Unlock size={10} />}
                  {ratioLocked ? 'LOCKED' : 'UNLOCKED'}
                </button>
              </div>
              <div className="inspector-row"><span>CAPTURE ID</span><strong>{selectedSlot.captureId}</strong></div>
              <div className="inspector-row"><span>X</span><strong>{Math.round(selectedSlot.x)}%</strong></div>
              <div className="inspector-row"><span>Y</span><strong>{Math.round(selectedSlot.y)}%</strong></div>
              <div className="inspector-row"><span>W</span><strong>{Math.round(selectedSlot.w)}%</strong></div>
              <div className="inspector-row"><span>H</span><strong>{Math.round(selectedSlot.h)}%</strong></div>
            </div>
          ) : (
            <div className="frame-slot-inspector frame-slot-inspector-empty">
              <div className="inspector-header">SLOT INSPECTOR</div>
              <p>Select a slot to view its position and size values.</p>
            </div>
          )}

          {/* ⚠️ PANEL PHOTO TRANSFORM */}
          <div className="frame-slot-inspector">
            <div className="inspector-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>PHOTO TRANSFORM</span>
              <button
                type="button"
                onClick={resetPhotoTransform}
                title="Reset transform"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
                  background: 'rgba(255,255,255,.08)',
                  border: '1px solid rgba(255,255,255,.2)',
                  color: 'rgba(255,255,255,.7)',
                  cursor: 'pointer',
                }}
              >
                <RotateCcw size={10} /> RESET
              </button>
            </div>

            {/* Preview dummy foto dengan transform */}
            <div
              style={{
                width: '100%',
                aspectRatio: '16 / 9',
                background: '#0a0a0a',
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
                }}
              >
                FOTO
              </div>
            </div>

            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,.6)', marginBottom: 4 }}>
                  <span>OFFSET X</span><strong style={{ color: '#ffd94e' }}>{photoOffsetX.toFixed(0)}%</strong>
                </div>
                <input
                  type="range" min={-50} max={50} step={1}
                  value={photoOffsetX}
                  onChange={(e) => setPhotoTransform({ photoOffsetX: parseInt(e.target.value, 10) })}
                  style={sliderStyle}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,.6)', marginBottom: 4 }}>
                  <span>OFFSET Y</span><strong style={{ color: '#ffd94e' }}>{photoOffsetY.toFixed(0)}%</strong>
                </div>
                <input
                  type="range" min={-50} max={50} step={1}
                  value={photoOffsetY}
                  onChange={(e) => setPhotoTransform({ photoOffsetY: parseInt(e.target.value, 10) })}
                  style={sliderStyle}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,.6)', marginBottom: 4 }}>
                  <span>SCALE (ZOOM)</span><strong style={{ color: '#ffd94e' }}>{photoScale.toFixed(2)}x</strong>
                </div>
                <input
                  type="range" min={0.5} max={2} step={0.05}
                  value={photoScale}
                  onChange={(e) => setPhotoTransform({ photoScale: parseFloat(e.target.value) })}
                  style={sliderStyle}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,.6)', marginBottom: 4 }}>
                  <span>ROTATION</span><strong style={{ color: '#ffd94e' }}>{photoRotation.toFixed(0)}°</strong>
                </div>
                <input
                  type="range" min={-180} max={180} step={1}
                  value={photoRotation}
                  onChange={(e) => setPhotoTransform({ photoRotation: parseInt(e.target.value, 10) })}
                  style={sliderStyle}
                />
              </div>
            </div>

            <p style={{ margin: '8px 0 0', fontSize: 10, color: 'rgba(255,255,255,.4)', lineHeight: 1.4 }}>
              Transform berlaku ke <strong style={{ color: '#ffd94e' }}>semua slot</strong> di frame ini.
            </p>
          </div>

          {/* PANEL WATERMARK */}
          <div className="frame-slot-inspector">
            <div className="inspector-header">WATERMARK</div>
            {frame.slotFrameImage ? (
              <>
                <div
                  style={{
                    width: '100%',
                    background: 'repeating-conic-gradient(#2a2522 0% 25%, #1a1614 0% 50%) 50% / 16px 16px',
                    border: '1px solid rgba(255,255,255,.15)',
                    display: 'grid',
                    placeItems: 'center',
                    overflow: 'hidden',
                    lineHeight: 0,
                  }}
                >
                  <img
                    src={frame.slotFrameImage}
                    alt="Watermark preview"
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                  />
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 11, color: 'rgba(255,255,255,.5)', lineHeight: 1.4 }}>
                  Watermark ini diaplikasikan ke <strong style={{ color: '#ffd94e' }}>semua foto slot</strong> saat composite.
                </p>
                <button
                  type="button"
                  onClick={() => onSlotFrameChange('')}
                  style={{
                    marginTop: 10, padding: '8px 12px',
                    background: 'transparent',
                    border: '1px solid rgba(239,63,37,.5)',
                    color: '#ef3f25', fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <X size={12} /> HAPUS WATERMARK
                </button>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,.4)', lineHeight: 1.5 }}>
                Belum ada watermark. Klik <strong style={{ color: '#ffd94e' }}>UPLOAD WATERMARK</strong> di toolbar.
              </p>
            )}
          </div>
        </div>
      </div>
      {frame.slots.length === 0 ? <p className="frame-editor-empty">No slots yet. Add a slot to define where captured photos appear on the frame.</p> : null}
    </div>
  );
};