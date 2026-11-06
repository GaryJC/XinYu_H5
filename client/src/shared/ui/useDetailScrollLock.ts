import { useLayoutEffect } from 'react';

let openDetails = 0;
let listPosition = 0;

// The document, rather than body, scrolls the mobile list. Lock it before
// the portal's first paint, including while the detail request is pending.
export function useDetailScrollLock(open: boolean) {
  useLayoutEffect(() => {
    if (!open || !window.matchMedia('(max-width: 767px), (pointer: coarse)').matches) return;
    const root = document.documentElement;
    if (openDetails === 0) {
      listPosition = window.scrollY;
      root.style.setProperty('--detail-list-top', `-${listPosition}px`);
      root.classList.add('detail-scroll-locked');
    }
    openDetails++;
    return () => {
      if (--openDetails !== 0) return;
      root.classList.remove('detail-scroll-locked');
      root.style.removeProperty('--detail-list-top');
      window.scrollTo({ top: listPosition, behavior: 'instant' });
    };
  }, [open]);
}
