// All dimensions are in twips (1/1440 inch). Reserve room for Word's
// mandatory paragraph after each table and for explicit page breaks.
export const PHOTO_PAGE_WIDTH = 10946;
export const PHOTO_PAGE_HEIGHT = 15600;
export const PHOTO_GAP = 60;
// Include cell spacing in each third so three tall photos still fit vertically.
// Portraits retain the readable three-column size. Landscape photos need
// a wider two-column box by default, with a three-column option below.
export const PHOTO_PORTRAIT_WIDTH = Math.floor(PHOTO_PAGE_WIDTH / 3) - 2 * PHOTO_GAP;
export const PHOTO_MAX_WIDTH = Math.floor(PHOTO_PAGE_WIDTH / 2) - 2 * PHOTO_GAP;
export const PHOTO_MAX_HEIGHT = Math.floor(PHOTO_PAGE_HEIGHT / 3) - 2 * PHOTO_GAP - 60;

// Preserve album order. Search rows of 1–3 photos and up to five rows per
// page, minimizing page count, then landscape size reductions, then height.
// Portraits never shrink to a landscape neighbor’s height. Three-column
// landscapes remain at least the standard column width (about 6.2 cm).
export function layoutOrderPhotos(images) {
  const standard = layoutAtHeight(images, PHOTO_MAX_HEIGHT);
  if (standard.length <= 1) return standard;
  // A four-row sheet trades a little image size for substantially fewer pages.
  // Keep the larger layout when this does not save any paper.
  const dense = layoutAtHeight(images, Math.floor(PHOTO_PAGE_HEIGHT / 4) - 2 * PHOTO_GAP - 60);
  return dense.length < standard.length ? dense : standard;
}

function layoutAtHeight(images, maxHeight) {
  const sized = images.map((image, index) => {
    const scale = Math.min((image.width >= image.height ? PHOTO_MAX_WIDTH : PHOTO_PORTRAIT_WIDTH) / image.width, maxHeight / image.height);
    return { index, width: Math.floor(image.width * scale), height: Math.floor(image.height * scale) };
  });
  const compact = images.map((image, index) => {
    const scale = Math.min(PHOTO_PORTRAIT_WIDTH / image.width, maxHeight / image.height);
    return { index, width: Math.floor(image.width * scale), height: Math.floor(image.height * scale) };
  });
  const best = Array(images.length + 1);
  best[images.length] = { pages: 0, reductions: 0, height: 0, rows: [], next: images.length };
  for (let start = images.length - 1; start >= 0; start--) {
    function visit(offset, rows, usedHeight, reductions) {
      if (rows.length) {
        const tail = best[offset];
        const candidate = { pages: tail.pages + 1, reductions: tail.reductions + reductions, height: tail.height + usedHeight, rows, next: offset };
        const current = best[start];
        if (!current || candidate.pages < current.pages || (candidate.pages === current.pages && (candidate.reductions < current.reductions || (candidate.reductions === current.reductions && (candidate.height < current.height || (candidate.height === current.height && candidate.next > current.next)))))) best[start] = candidate;
      }
      if (rows.length === 5) return;
      for (let count = 1; count <= 3 && offset + count <= images.length; count++) {
        const normal = sized.slice(offset, offset + count);
        const options = [normal];
        if (count === 3 && normal.some(cell => cell.width > PHOTO_PORTRAIT_WIDTH)) options.push(compact.slice(offset, offset + count));
        for (const cells of options) {
          if (cells.reduce((sum, cell) => sum + cell.width + 2 * PHOTO_GAP, 0) > PHOTO_PAGE_WIDTH) continue;
          const rowHeight = Math.max(...cells.map(cell => cell.height)) + 2 * PHOTO_GAP + 60;
          if (usedHeight + rowHeight > PHOTO_PAGE_HEIGHT) continue;
          const reduced = cells.filter(cell => cell.width < sized[cell.index].width).length;
          visit(offset + count, [...rows, cells], usedHeight + rowHeight, reductions + reduced);
        }
      }
    }
    visit(start, [], 0, 0);
  }
  const pages = [];
  for (let index = 0; index < images.length; index = best[index].next) pages.push(best[index].rows);
  return pages;
}
