import { useEffect, useRef } from 'react';

// Wait for both async task data and the drawer's opening animation.
export function useDispatchProjectFocus(orderId: string | undefined, ready: boolean) {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const url = new URL(location.href);
    if (!ready || !orderId || url.searchParams.get('dispatchOrder') !== orderId || url.searchParams.get('dispatchSection') !== 'repairs') return;
    const frame = requestAnimationFrame(() => {
      if (!target.current) return;
      target.current.scrollIntoView({ block: 'start', behavior: 'auto' });
      target.current.focus({ preventScroll: true });
      const current = new URL(location.href);
      if (current.searchParams.get('dispatchOrder') === orderId) {
        current.searchParams.delete('dispatchSection');
        history.replaceState(null, '', current);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [orderId, ready]);
  return target;
}
