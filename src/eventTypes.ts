/* ============================================================
   EVENT TYPES — type definitions untuk event, frame, slot
   Dipisah dari eventStore.ts biar tidak circular dependency
   ============================================================ */

export type Slot = {
  id: string;
  captureId: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Frame = {
  id: string;
  name: string;
  image: string;
  slots: Slot[];
};

export type OutputSettings = {
  destinationFolder: string;
  fileNaming: string;
  savePhotos: boolean;
  saveVideos: boolean;
};

export type PrinterSettings = {
  printer: string;
  paperSize: string;
  copies: number;
};

export type EventStatus = 'Ready' | 'Active' | 'Ended';

export type R3aEvent = {
  id: string;
  slug?: string;
  eventName: string;
  clientName: string;
  date: string;
  location: string;
  frames: Frame[];
  outputSettings: OutputSettings;
  printerSettings: PrinterSettings;
  eventStatus: EventStatus;
  createdAt: number;
  updatedAt: number;
};