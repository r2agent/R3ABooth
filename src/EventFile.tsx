import { useEffect, useState } from 'react';
import { ChevronRight, Image as ImageIcon, Plus, Trash2, Cloud, Copy, Check, AlertCircle, ExternalLink } from 'lucide-react';
import { FrameEditor } from './FrameEditor';
import { createFrame, createSlot, duplicateSlot, saveEvent } from './eventStore';
import type { R3aEvent, Frame, Slot } from './eventStore';
import { publishEventToCloud, buildEventUrl, generateSlug } from './cloudEventSync';

type EventFileTab = 'event' | 'frame' | 'status';

export const EventFile = ({ event, onSaved, onHome }: { event: R3aEvent; onSaved: (event: R3aEvent) => void; onHome: () => void }) => {
  const [activeTab, setActiveTab] = useState<EventFileTab>(
    event.eventName ? 'status' : 'event'
  );
  const [draft, setDraft] = useState<R3aEvent>(event);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setDraft(event);
    setActiveFrameIndex(0);
    setPublishedSlug(event.slug || null);
    setPublishMessage(null);
    setPublishError(null);
    setActiveTab(event.eventName ? 'status' : 'event');
  }, [event]);

  const tabs: { id: EventFileTab; label: string }[] = [
    { id: 'event', label: 'EVENT INFORMATION' },
    { id: 'frame', label: 'FRAME' },
    { id: 'status', label: 'EVENT STATUS' },
  ];

  const setField = (key: keyof R3aEvent, value: string) => setDraft({ ...draft, [key]: value });

  const activeFrame = draft.frames[activeFrameIndex];

  const addFrame = () => {
    const frame = createFrame(`Frame ${draft.frames.length + 1}`, '');
    setDraft({ ...draft, frames: [...draft.frames, frame] });
    setActiveFrameIndex(draft.frames.length);
  };

  const deleteFrame = (index: number) => {
    const frames = draft.frames.filter((_, i) => i !== index);
    setDraft({ ...draft, frames });
    if (activeFrameIndex >= frames.length) setActiveFrameIndex(Math.max(0, frames.length - 1));
  };

  const updateFrame = (index: number, updates: Partial<Frame>) => {
    setDraft({ ...draft, frames: draft.frames.map((f, i) => (i === index ? { ...f, ...updates } : f)) });
  };

  const applyTransformToAllFrames = () => {
    const src = draft.frames[activeFrameIndex];
    if (!src) return;
    setDraft({
      ...draft,
      frames: draft.frames.map((f, i) =>
        i === activeFrameIndex
          ? f
          : {
              ...f,
              photoOffsetX: src.photoOffsetX ?? 0,
              photoOffsetY: src.photoOffsetY ?? 0,
              photoScale: src.photoScale ?? 1,
              photoRotation: src.photoRotation ?? 0,
            },
      ),
    });
  };

  const updateFrameSlots = (index: number, slots: Slot[]) => updateFrame(index, { slots });

  const addSlotToFrame = (frameIndex: number, captureId: string, w: number, h: number) => {
    const slot = createSlot(captureId, w, h);
    updateFrame(frameIndex, { slots: [...draft.frames[frameIndex].slots, slot] });
  };

  const duplicateSlotInFrame = (frameIndex: number, slot: Slot) => {
    const newSlot = duplicateSlot(slot);
    updateFrame(frameIndex, { slots: [...draft.frames[frameIndex].slots, newSlot] });
  };

  const deleteSlotFromFrame = (frameIndex: number, slotId: string) => {
    updateFrame(frameIndex, { slots: draft.frames[frameIndex].slots.filter((s) => s.id !== slotId) });
  };

  const uploadFrameImage = (frameIndex: number, file: File) => {
    const reader = new FileReader();
    reader.onload = () => updateFrame(frameIndex, { image: reader.result as string });
    reader.readAsDataURL(file);
  };

  const uploadSlotFrameImage = (frameIndex: number, file: File) => {
    const reader = new FileReader();
    reader.onload = () => updateFrame(frameIndex, { slotFrameImage: reader.result as string });
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    const timeout = setTimeout(() => { setSaving(false); setSaveError('Save timed out. Please try again.'); }, 10000);
    try {
      const toSave: R3aEvent = { ...draft, updatedAt: Date.now() };
      await saveEvent(toSave);
      clearTimeout(timeout);
      onSaved(toSave);
    } catch (err) {
      clearTimeout(timeout);
      setSaveError(err instanceof Error ? err.message : 'Failed to save event');
    } finally {
      clearTimeout(timeout);
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    setPublishError(null);
    setPublishMessage(null);

    try {
      const slug = draft.slug || generateSlug(draft.eventName || 'untitled');
      if (!slug) {
        setPublishError('Nama event tidak valid. Isi nama event dulu.');
        setPublishing(false);
        return;
      }

      const toSave: R3aEvent = { ...draft, slug, updatedAt: Date.now() };
      await saveEvent(toSave);
      setDraft(toSave);

      const result = await publishEventToCloud(toSave);

      if (result.success && result.slug) {
        setPublishedSlug(result.slug);
        setPublishMessage(`Berhasil publish! Event bisa diakses di URL di bawah.`);
        onSaved(toSave);
      } else {
        setPublishError(result.error || 'Gagal publish ke cloud.');
      }
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Gagal publish');
    } finally {
      setPublishing(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!publishedSlug) return;
    const url = buildEventUrl(publishedSlug);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenUrl = () => {
    if (!publishedSlug) return;
    const url = buildEventUrl(publishedSlug);
    window.open(url, '_blank');
  };

  const slugPreview = draft.slug || generateSlug(draft.eventName || 'untitled');
  const fullUrl = slugPreview ? buildEventUrl(slugPreview) : '';

  return (
    <main className="new-project-screen">
      <div className="new-project-grain" aria-hidden="true" />
      <div className="new-project-decoration new-project-decoration-top" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
      <div className="new-project-decoration new-project-decoration-bottom" aria-hidden="true"><i /><i /><i /><i /></div>
      <header className="new-project-header"><p>R3A BOOTH</p><h1>{draft.eventName ? draft.eventName.toUpperCase() : 'NEW EVENT'}</h1><span /></header>
      <nav className="new-project-tabs" aria-label="Event file sections">{tabs.map((tab) => <button className={activeTab === tab.id ? 'new-project-tab is-active' : 'new-project-tab'} key={tab.id} onClick={() => setActiveTab(tab.id)} type="button">{tab.label}</button>)}</nav>
      <section className="new-project-content">
        {activeTab === 'event' ? (
          <div className="new-project-panel event-panel">
            <div className="new-project-fields">
              <label><span>EVENT NAME</span><input value={draft.eventName} onChange={(e) => setField('eventName', e.target.value)} placeholder="Enter event name" /></label>
              <label><span>CLIENT NAME</span><input value={draft.clientName} onChange={(e) => setField('clientName', e.target.value)} placeholder="Enter client name" /></label>
              <label><span>DATE</span><input type="date" value={draft.date} onChange={(e) => setField('date', e.target.value)} /></label>
              <label><span>LOCATION</span><input value={draft.location} onChange={(e) => setField('location', e.target.value)} placeholder="Enter location" /></label>
            </div>
            <div className="new-project-note"><span>01</span><strong>Event details</strong><p>Set up the event that will run in the photobooth session.</p></div>
          </div>
        ) : null}

        {activeTab === 'frame' ? (
          <div className="new-project-panel">
            <div className="frame-tab-layout">
              <div className="frame-sidebar">
                <div className="frame-sidebar-header">
                  <span>FRAMES</span>
                  <button onClick={addFrame} type="button" className="frame-add-button"><Plus size={16} /></button>
                </div>
                <div className="frame-sidebar-list">
                  {draft.frames.length === 0 ? <p className="frame-sidebar-empty">No frames yet. Add a frame to get started.</p> : null}
                  {draft.frames.map((frame, index) => (
                    <div key={frame.id} className={`frame-sidebar-item ${index === activeFrameIndex ? 'is-active' : ''}`} onClick={() => setActiveFrameIndex(index)}>
                      <div className="frame-sidebar-thumb" style={{ background: frame.image ? `url(${frame.image}) center/cover` : '#3a3431' }}>
                        {!frame.image ? <ImageIcon size={20} /> : null}
                      </div>
                      <div className="frame-sidebar-info">
                        <strong>{frame.name}</strong>
                        <span>{frame.slots.length} slots</span>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); deleteFrame(index); }} type="button" className="frame-sidebar-delete"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="frame-editor-area">
                {activeFrame ? (
                  <FrameEditor
                    frame={activeFrame}
                    onSlotsChange={(slots) => updateFrameSlots(activeFrameIndex, slots)}
                    onAddSlot={(captureId, w, h) => addSlotToFrame(activeFrameIndex, captureId, w, h)}
                    onDuplicateSlot={(slot) => duplicateSlotInFrame(activeFrameIndex, slot)}
                    onDeleteSlot={(slotId) => deleteSlotFromFrame(activeFrameIndex, slotId)}
                    onUploadImage={(file) => uploadFrameImage(activeFrameIndex, file)}
                    onUploadSlotFrame={(file) => uploadSlotFrameImage(activeFrameIndex, file)}
                    onSlotFrameChange={(dataUrl) => updateFrame(activeFrameIndex, { slotFrameImage: dataUrl })}
                    onFrameChange={(updates) => updateFrame(activeFrameIndex, updates)}
                    onApplyTransformToAll={applyTransformToAllFrames}
                  />
                ) : (
                  <div className="frame-editor-empty-state">
                    <ImageIcon size={48} strokeWidth={1} />
                    <strong>No frame selected</strong>
                    <p>Add a frame to define slots for captured photos.</p>
                    <button onClick={addFrame} type="button" className="frame-add-large"><Plus size={18} /> ADD FRAME</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'status' ? (
          <div className="new-project-panel status-panel">
            <div className="event-status-card">
              <div>
                <span>EVENT STATUS</span>
                <strong>{draft.eventStatus}</strong>
                <p>{draft.frames.length} frame(s) configured. {draft.frames.reduce((acc, f) => acc + f.slots.length, 0)} total slots.</p>
              </div>
              <div className="status-pill"><i />{draft.eventStatus.toUpperCase()}</div>
            </div>
            <div className="status-actions">
              <button className="status-action" type="button" onClick={() => setDraft({ ...draft, eventStatus: 'Active' })}>START EVENT <ChevronRight size={20} /></button>
              <button className="status-action muted" type="button" onClick={() => setDraft({ ...draft, eventStatus: 'Ended' })}>END EVENT <ChevronRight size={20} /></button>
            </div>

            <div
              style={{
                marginTop: 32,
                paddingTop: 24,
                borderTop: '2px solid rgba(255,255,255,.35)',
                maxWidth: 760,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <Cloud size={22} color="#ffd94e" />
                <h3 style={{ margin: 0, fontSize: 18, letterSpacing: '.06em', color: '#fff' }}>
                  PUBLISH TO CLOUD
                </h3>
              </div>

              <p style={{ color: 'rgba(255,245,227,.7)', fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
                Publish event ke Firebase supaya bisa diakses dari device lain via URL unik.
                Guest bisa scan QR atau buka link di HP mereka.
              </p>

              <div style={{ marginBottom: 16 }}>
                <span style={{ color: 'rgba(255,244,220,.75)', fontSize: 11, fontWeight: 700, letterSpacing: '.18em' }}>
                  EVENT SLUG
                </span>
                <div
                  style={{
                    marginTop: 6,
                    padding: '10px 14px',
                    background: 'rgba(0,0,0,.3)',
                    border: '1px solid rgba(255,255,255,.15)',
                    fontFamily: 'monospace',
                    fontSize: 13,
                    color: '#ffd94e',
                    wordBreak: 'break-all',
                  }}
                >
                  {slugPreview || '—'}
                </div>
              </div>

              {slugPreview ? (
                <div style={{ marginBottom: 16 }}>
                  <span style={{ color: 'rgba(255,244,220,.75)', fontSize: 11, fontWeight: 700, letterSpacing: '.18em' }}>
                    SHARE URL
                  </span>
                  <div
                    style={{
                      marginTop: 6,
                      padding: '10px 14px',
                      background: 'rgba(0,0,0,.3)',
                      border: '1px solid rgba(255,255,255,.15)',
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: '#fff',
                      wordBreak: 'break-all',
                    }}
                  >
                    {fullUrl}
                  </div>
                </div>
              ) : null}

              {publishMessage ? (
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'rgba(74,222,128,.15)',
                    border: '1px solid rgba(74,222,128,.4)',
                    color: '#4ade80',
                    fontSize: 13,
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Check size={16} /> {publishMessage}
                </div>
              ) : null}

              {publishError ? (
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'rgba(239,63,37,.15)',
                    border: '1px solid rgba(239,63,37,.4)',
                    color: '#ff9f7a',
                    fontSize: 13,
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <AlertCircle size={16} /> {publishError}
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={handlePublish}
                  disabled={publishing || !draft.eventName}
                  type="button"
                  style={{
                    padding: '12px 20px',
                    background: publishing || !draft.eventName ? '#555' : '#ef3f25',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: 13,
                    letterSpacing: '.06em',
                    cursor: publishing || !draft.eventName ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Cloud size={16} />
                  {publishing ? 'PUBLISHING...' : publishedSlug ? 'RE-PUBLISH' : 'PUBLISH NOW'}
                </button>

                {publishedSlug ? (
                  <>
                    <button
                      onClick={handleCopyUrl}
                      type="button"
                      style={{
                        padding: '12px 20px',
                        background: copied ? '#4ade80' : 'rgba(255,255,255,.1)',
                        color: copied ? '#000' : '#fff',
                        border: '1px solid rgba(255,255,255,.25)',
                        fontWeight: 700,
                        fontSize: 13,
                        letterSpacing: '.06em',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                      {copied ? 'COPIED!' : 'COPY URL'}
                    </button>

                    <button
                      onClick={handleOpenUrl}
                      type="button"
                      style={{
                        padding: '12px 20px',
                        background: 'rgba(255,255,255,.1)',
                        color: '#fff',
                        border: '1px solid rgba(255,255,255,.25)',
                        fontWeight: 700,
                        fontSize: 13,
                        letterSpacing: '.06em',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <ExternalLink size={16} />
                      OPEN URL
                    </button>
                  </>
                ) : null}
              </div>

              {!draft.eventName ? (
                <p style={{ marginTop: 12, color: '#ff9f7a', fontSize: 12 }}>
                  ⚠️ Isi nama event dulu sebelum publish.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
      <footer className="new-project-footer">
        <button onClick={onHome} type="button">HOME</button>
        <button className="save-settings-button" type="button" onClick={handleSave} disabled={saving}>{saving ? 'SAVING...' : 'SAVE EVENT'} <span>✓</span></button>
        {saveError ? <span className="save-error-text" style={{ color: '#ff9f7a' }}>{saveError}</span> : null}
      </footer>
    </main>
  );
};