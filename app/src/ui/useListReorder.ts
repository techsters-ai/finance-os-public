// Reordering a list by drag and drop: hold a row still, then drag it up or down within its section while the
// other rows make room. Rows carry data-reorder-id and data-reorder-section; the root is the scrolling screen.
import { useEffect, useRef } from 'preact/hooks';

const HOLD_MS = 350;
const STILL_PX = 8;
/** Near the top or bottom of the screen (above the tab bar) the list scrolls by itself. */
const EDGE_TOP = 90;
const EDGE_BOTTOM = 140;

interface Lift {
  row: HTMLElement;
  section: string;
  rows: HTMLElement[];
  /** Row centers in the screen's content coordinates, as they stood when the row was lifted. */
  mids: number[];
  from: number;
  to: number;
  height: number;
  y0: number;
  y: number;
  frame: number;
}

/** onDrop(section, srcId, targetId): the row srcId now stands where targetId stood. */
export function useListReorder(root: { current: HTMLElement | null }, onDrop: (section: string, srcId: string, targetId: string) => void): void {
  const drop = useRef(onDrop);
  drop.current = onDrop;
  useEffect(() => {
    const screen = root.current;
    if (!screen) return;
    let press: { row: HTMLElement; pointerId: number; x0: number; y0: number; timer: number } | null = null;
    let lift: Lift | null = null;
    let guard = false;

    const contentY = (clientY: number) => clientY - screen.getBoundingClientRect().top + screen.scrollTop;

    const layout = (l: Lift) => {
      const dy = contentY(l.y) - l.y0;
      const center = l.mids[l.from] + dy;
      l.to = l.mids.filter((m, i) => i !== l.from && m < center).length;
      l.rows.forEach((r, i) => {
        if (i === l.from) {
          r.style.transform = `translateY(${dy}px) scale(1.02)`;
          return;
        }
        const k = i < l.from ? i : i - 1; // its place among the other rows
        const shift = i < l.from ? (k >= l.to ? l.height : 0) : k < l.to ? -l.height : 0;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };

    const tick = () => {
      if (!lift) return;
      const r = screen.getBoundingClientRect();
      const bottom = Math.min(r.bottom, window.innerHeight);
      const dir = lift.y < r.top + EDGE_TOP ? -1 : lift.y > bottom - EDGE_BOTTOM ? 1 : 0;
      if (dir) {
        screen.scrollTop += dir * 7;
        layout(lift);
      }
      lift.frame = requestAnimationFrame(tick);
    };

    const begin = () => {
      if (!press) return;
      const { row, y0 } = press;
      press = null;
      const section = row.dataset.reorderSection ?? '';
      const rows = [...screen.querySelectorAll<HTMLElement>('[data-reorder-section]')].filter((r) => r.dataset.reorderSection === section);
      const from = rows.indexOf(row);
      if (from < 0 || rows.length < 2) return;
      const mids = rows.map((r) => {
        const b = r.getBoundingClientRect();
        return contentY(b.top) + b.height / 2;
      });
      lift = { row, section, rows, mids, from, to: from, height: row.getBoundingClientRect().height, y0: contentY(y0), y: y0, frame: 0 };
      row.parentElement?.classList.add('reorder-active');
      row.classList.add('reorder-lifted');
      navigator.vibrate?.(8);
      layout(lift);
      lift.frame = requestAnimationFrame(tick);
    };

    const finish = (commit: boolean) => {
      if (press) clearTimeout(press.timer);
      press = null;
      const l = lift;
      if (!l) return;
      lift = null;
      cancelAnimationFrame(l.frame);
      l.row.parentElement?.classList.remove('reorder-active');
      l.row.classList.remove('reorder-lifted');
      l.rows.forEach((r) => (r.style.transform = ''));
      guard = true;
      setTimeout(() => (guard = false), 400);
      if (commit && l.to !== l.from) drop.current(l.section, l.rows[l.from].dataset.reorderId!, l.rows[l.to].dataset.reorderId!);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button > 0 || lift) return;
      const row = (e.target as Element).closest<HTMLElement>('[data-reorder-id]');
      if (!row) return;
      press = { row, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, timer: window.setTimeout(begin, HOLD_MS) };
    };
    const onMove = (e: PointerEvent) => {
      if (lift) {
        lift.y = e.clientY;
        layout(lift);
      } else if (press && e.pointerId === press.pointerId && Math.hypot(e.clientX - press.x0, e.clientY - press.y0) > STILL_PX) {
        finish(false); // a scroll or a swipe, not a hold
      }
    };
    const onUp = (e: PointerEvent) => finish(e.type === 'pointerup');
    // Once a row is lifted the screen must not scroll under the finger (the board does the same).
    const onTouchMove = (e: TouchEvent) => {
      if (lift) e.preventDefault();
    };
    // The click that ends a drag must not open the row.
    const onClick = (e: MouseEvent) => {
      if (!guard) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onContextMenu = (e: Event) => {
      if (press || lift) e.preventDefault();
    };

    screen.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    screen.addEventListener('click', onClick, true);
    screen.addEventListener('contextmenu', onContextMenu);
    return () => {
      finish(false);
      screen.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('touchmove', onTouchMove);
      screen.removeEventListener('click', onClick, true);
      screen.removeEventListener('contextmenu', onContextMenu);
    };
  }, [root]);
}
