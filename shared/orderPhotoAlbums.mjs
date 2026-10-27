export const photoAlbumLabels = { reception: '接车时', repair: '维修时', completed: '维修完成' };
export function collectOrderPhotoAlbums(order, repairFiles = []) {
  const hidden = new Set(order.inspection?.replacedPhotoIds || []);
  const files = new Map([...(order.files || []), ...repairFiles].map(file => [file.id, file]));
  const albums = { reception: [], repair: [], completed: [] };
  for (const file of files.values()) {
    if (hidden.has(file.id) || !file.mimeType?.startsWith('image/') || file.kind === 'signature_image') continue;
    const category = file.kind === 'repair_completed_photo' ? 'completed'
      : ['repair_progress_photo', 'repair_parts_photo'].includes(file.kind) ? 'repair' : 'reception';
    albums[category].push(file);
  }
  for (const album of Object.values(albums)) album.sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
  return albums;
}
