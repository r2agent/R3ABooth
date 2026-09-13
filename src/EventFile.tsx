import { useEffect, useState, type CSSProperties } from 'react';
import { ChevronRight, Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import { FrameEditor } from './FrameEditor';
import { createFrame, createSlot, duplicateSlot, saveEvent, type R3aEvent, type Frame, type Slot } from './eventStore';

type EventFileTab = 'event' | 'frame' | 'status';

export const EventFile = ({ event, onSaved, onHome }: { event: R3aEvent; onSaved: (event: R3aEvent) => void; onHome: () => void }) => {
  const [activeTab, setActiveTab] = useState<EventFileTab>('event');
  const [draft, setDraft] = useState<R3aEvent>(event);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => { setDraft(event); setActiveFrameIndex(0); }, [event]);

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

  const updateFrameSlots = (index: number, slots: Slot[]) => updateFrame(index, { slots });

  const addSlotToFrame = (frameIndex: number, captureId: string) => {
    const slot = createSlot(captureId);
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
                    onAddSlot={(captureId) => addSlotToFrame(activeFrameIndex, captureId)}
                    onDuplicateSlot={(slot) => duplicateSlotInFrame(activeFrameIndex, slot)}
                    onDeleteSlot={(slotId) => deleteSlotFromFrame(activeFrameIndex, slotId)}
                    onUploadImage={(file) => uploadFrameImage(activeFrameIndex, file)}
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
