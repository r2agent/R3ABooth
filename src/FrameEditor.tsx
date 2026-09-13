import { useRef, useState, useCallback, useEffect, type CSSProperties } from 'react';
import { Copy, Plus, Trash2, Upload } from 'lucide-react';
import { createSlot, duplicateSlot, type Frame, type Slot } from './eventStore';

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

export const FrameEditor = ({ frame, onSlotsChange, onAddSlot, onDuplicateSlot, onDeleteSlot, onUploadImage }: {
  frame: Frame;
  onSlotsChange: (slots: Slot[]) => void;
  onAddSlot: (captureId: string) => void;
  onDuplicateSlot: (slot: Slot) => void;
  onDeleteSlot: (slotId: string) => void;
  onUploadImage: (file: File) => void;
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [frameAspect, setFrameAspect] = useState(3 / 2);

  useEffect(() => {
    if (!frame.image) { setFrameAspect(3 / 2); return; }
    const img = new Image();
    img.onload = () => setFrameAspect(img.naturalWidth / img.naturalHeight);
    img.src = frame.image;
  }, [frame.image]);

  const selectedSlot = frame.slots.find((s) => s.id === selectedSlotId) ?? null;

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
        return { ...s, x: Math.max(0, Math.min(100 - s.w, drag.origX + dxPct)), y: Math.max(0, Math.min(100 - s.h, drag.origY + dyPct)) };
      }
      const newW = Math.max(5, Math.min(100 - s.x, drag.origW + dxPct));
      const newH = Math.max(5, Math.min(100 - s.y, drag.origH + dyPct));
      return { ...s, w: newW, h: newH };
    }));
  }, [drag, frame.slots, getRectPct, onSlotsChange]);

  const handleMouseUp = useCallback(() => setDrag(null), []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.match(/^image\/(png|jpeg)$/)) return;
    onUploadImage(file);
    e.target.value = '';
  };

  return (
    <div className="frame-editor">
      <div className="frame-editor-toolbar">
        <button type="button" onClick={() => onAddSlot(`cap-${frame.slots.length + 1}`)}><Plus size={16} /> ADD SLOT</button>
        {selectedSlotId ? <button type="button" onClick={() => { const s = frame.slots.find((sl) => sl.id === selectedSlotId); if (s) onDuplicateSlot(s); }}><Copy size={16} /> DUPLICATE</button> : null}
        {selectedSlotId ? <button type="button" onClick={() => { onDeleteSlot(selectedSlotId); setSelectedSlotId(null); }}><Trash2 size={16} /> DELETE</button> : null}
        <label className="frame-upload-label">
          <Upload size={16} /> UPLOAD FRAME IMAGE
          <input type="file" accept="image/png,image/jpeg" onChange={handleFileUpload} hidden />
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
        {selectedSlot ? (
          <div className="frame-slot-inspector">
            <div className="inspector-header">SLOT INSPECTOR</div>
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
      </div>
      {frame.slots.length === 0 ? <p className="frame-editor-empty">No slots yet. Add a slot to define where captured photos appear on the frame.</p> : null}
    </div>
  );
};
