// Pull to refresh: drag the screen down from its very top to run `onRefresh`. The pull opens a gap above the
// content (a gear turns with it); past the threshold a release starts the refresh, the gear spins until it's done.
// Touch only; the screen's own bounce is held off while pulling (a non-passive touchmove).
import { useEffect, useRef, useState } from 'preact/hooks';

const THRESHOLD = 64;
const MAX = 110;
const HOLD = 52;

export function usePullToRefresh(
  root: { current: HTMLElement | null },
  onRefresh: () => Promise<unknown>,
): { pull: number; refreshing: boolean; dragging: boolean } {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const busy = useRef(false);
  const run = useRef(onRefresh);
  run.current = onRefresh;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    let current = 0;

    const onStart = (e: TouchEvent) => {
      if (busy.current || el.scrollTop > 0 || e.touches.length !== 1) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      current = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const dy = e.touches[0].clientY - start.y;
      const dx = e.touches[0].clientX - start.x;
      if (current === 0 && (dy <= 0 || Math.abs(dx) > dy || el.scrollTop > 0)) {
        start = null; // a scroll or a swipe, not a pull
        return;
      }
      e.preventDefault();
      current = Math.min(MAX, dy * 0.5);
      setDragging(true);
      setPull(current);
    };
    const onEnd = () => {
      if (!start) return;
      start = null;
      setDragging(false);
      if (current < THRESHOLD) {
        setPull(0);
        return;
      }
      busy.current = true;
      setRefreshing(true);
      setPull(HOLD);
      void run.current()
        .catch(() => undefined)
        .finally(() => {
          busy.current = false;
          setRefreshing(false);
          setPull(0);
        });
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [root]);

  return { pull, refreshing, dragging };
}

/** How far the pull is toward the threshold, 0…1. */
export const pullProgress = (pull: number) => Math.min(1, pull / THRESHOLD);
