export function scrollToTaskSection(section: HTMLElement | null, itemId?: number) {
  if (!section) return;
  // Match stable IDs rather than names, which can repeat or be edited.
  const item = itemId == null ? undefined : Array.from(section.querySelectorAll<HTMLElement>('[data-repair-item-id]'))
    .find(element => element.dataset.repairItemId === String(itemId));
  const target = item || section;
  target.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  target.focus({ preventScroll: true });
}
