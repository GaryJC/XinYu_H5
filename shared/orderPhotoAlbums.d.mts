import type { WorkOrder, DispatchDetail, OrderPhotoCategory } from './types';
export const photoAlbumLabels: Record<OrderPhotoCategory, string>;
export function collectOrderPhotoAlbums(order: WorkOrder, repairFiles?: DispatchDetail['files']): Record<OrderPhotoCategory, DispatchDetail['files']>;
