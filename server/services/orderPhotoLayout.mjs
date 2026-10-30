// All dimensions are in twips (1/1440 inch). Reserve room for Word's
// mandatory paragraph after each table and for explicit page breaks.
export const PHOTO_PAGE_WIDTH = 10946;
export const PHOTO_PAGE_HEIGHT = 15600;
export const PHOTO_GAP = 60;
// Include cell spacing in each third so three tall photos still fit vertically.
export const PHOTO_MAX_WIDTH = Math.floor(PHOTO_PAGE_WIDTH / 3) - 2 * PHOTO_GAP;
export const PHOTO_MAX_HEIGHT = Math.floor(PHOTO_PAGE_HEIGHT / 3) - 2 * PHOTO_GAP - 60;

// Preserve album order. Search rows of 1–3 photos and up to five rows per
// page, minimizing page count first, then total row height. Each image is
// sized once, independently of its neighbors or the chosen page breaks.
export function layoutOrderPhotos(images) {
  const sized = images.map((image, index) => {
    const scale = Math.min(PHOTO_MAX_WIDTH / image.width, PHOTO_MAX_HEIGHT / image.height);
    return { index, width: Math.floor(image.width * scale), height: Math.floor(image.height * scale) };
  });
  const best = Array(images.length + 1);
  best[images.length] = { pages: 0, height: 0, rows: [], next: images.length };
  for (let start = images.length - 1; start >= 0; start--) {
    function visit(offset, rows, usedHeight) {
      if (rows.length) {
        const tail = best[offset];
        const candidate = { pages: tail.pages + 1, height: tail.height + usedHeight, rows, next: offset };
        const current = best[start];
        if (!current || candidate.pages < current.pages || (candidate.pages === current.pages && (candidate.height < current.height || (candidate.height === current.height && candidate.next > current.next)))) best[start] = candidate;
      }
      if (rows.length === 5) return;
      for (let count = 1; count <= 3 && offset + count <= images.length; count++) {
        const cells = sized.slice(offset, offset + count);
        const rowHeight = Math.max(...cells.map(cell => cell.height)) + 2 * PHOTO_GAP + 60;
        if (usedHeight + rowHeight > PHOTO_PAGE_HEIGHT) continue;
        visit(offset + count, [...rows, cells], usedHeight + rowHeight);
      }
    }
    visit(start, [], 0);
  }
  const pages = [];
  for (let index = 0; index < images.length; index = best[index].next) pages.push(best[index].rows);
  return pages;
}
