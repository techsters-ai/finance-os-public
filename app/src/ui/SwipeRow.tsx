// Swipe a row left to reveal a red Delete button, as in iOS lists; a tap on it deletes. One row is open at a time;
// a tap anywhere else closes it. Vertical scrolling stays with the browser (touch-action: pan-y).
import type { ComponentChildren } from 'preact';
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { cx } from './components';

const WIDTH = 88;
const AXIS_PX = 8;

let nextId = 0;
const openRow = signal<number | null>(null);

export function SwipeRow({ children, onDelete }: { children: ComponentChildren; onDelete: () => void }) {
  const me = useRef(0);
  if (!me.current) me.current = ++nextId;
  const root = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const pos = useRef(0);
  const gesture = useRef<{ x0: number; y0: number; base: number; axis: 'x' | 'y' | null; id: number } | null>(null);
  const swallow = useRef(false);
  const open = openRow.value === me.current;

  const moveTo = (v: number) => {
    pos.current = v;
    setX(v);
  };

  // Another row opened, or this one was closed from outside.
  useEffect(() => {
    if (!open && !gesture.current && pos.current !== 0) moveTo(0);
  }, [open]);

  // While open, a touch outside the row closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) openRow.value = null;
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  return (
    <div class={cx('swipe', x !== 0 && 'revealed')} ref={root}>
      <button
        type="button"
        class="swipe-delete"
        tabIndex={open ? 0 : -1}
        onClick={() => {
          openRow.value = null;
          onDelete();
        }}
      >
        Delete
      </button>
      <div
        class={cx('swipe-content', dragging && 'dragging')}
        style={{ transform: x ? `translateX(${x}px)` : undefined }}
        onPointerDown={(e) => {
          if (e.button > 0) return;
          gesture.current = { x0: e.clientX, y0: e.clientY, base: pos.current, axis: null, id: e.pointerId };
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g || e.pointerId !== g.id) return;
          const dx = e.clientX - g.x0;
          const dy = e.clientY - g.y0;
          if (!g.axis) {
            if (Math.hypot(dx, dy) < AXIS_PX) return;
            g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            if (g.axis === 'x') {
              setDragging(true);
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            }
          }
          if (g.axis !== 'x') return;
          let v = Math.min(0, g.base + dx);
          if (v < -WIDTH) v = -WIDTH + (v + WIDTH) / 3; // a little give past the button
          moveTo(v);
        }}
        onPointerUp={() => {
          const g = gesture.current;
          gesture.current = null;
          if (g?.axis !== 'x') return;
          // iOS sends no click after a move; other browsers do: drop it, but not the next real tap.
          swallow.current = true;
          setTimeout(() => (swallow.current = false), 350);
          setDragging(false);
          const nowOpen = pos.current < -WIDTH / 2;
          moveTo(nowOpen ? -WIDTH : 0);
          if (nowOpen) openRow.value = me.current;
          else if (open) openRow.value = null;
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setDragging(false);
          moveTo(open ? -WIDTH : 0);
        }}
        onClickCapture={(e) => {
          // The click that ends a swipe, or a tap on an open row (it closes), doesn't open the transaction.
          if (swallow.current || open) {
            e.preventDefault();
            e.stopPropagation();
            if (!swallow.current) openRow.value = null;
          }
          swallow.current = false;
        }}
      >
        {children}
      </div>
    </div>
  );
}
