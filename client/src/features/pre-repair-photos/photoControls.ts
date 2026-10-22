import type { PhotoSlot } from './photoSlots';

export type PhotoResult = boolean | void;
export type PhotoOperation = PhotoResult | Promise<PhotoResult>;
export type PreRepairPhotoControls = {
  uploading: string;
  error: string;
  successMessage?: string;
  progress?: { completed: number; total: number };
  upload: (slot: PhotoSlot | 'extra', file: File) => Promise<PhotoResult>;
  uploadExtras: (files: File[]) => Promise<PhotoResult>;
  removeExtras?: (ids: string[]) => PhotoOperation;
  removePhoto?: (id: string) => PhotoOperation;
  removeExtra?: (id: string) => PhotoOperation;
  removeMileage?: () => PhotoOperation;
  replaceExtra?: (id: string, file: File) => Promise<PhotoResult>;
};
