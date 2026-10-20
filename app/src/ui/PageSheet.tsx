// A screen presented as a sheet from the bottom: the screen it was opened from stays
// underneath, dimmed. Swipe down (from the bar, or from the top of the content), tap the dimmed part or press
// Escape to close it.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

const CLOSE_PX = 110;

export function PageSheet({ children, onClose }: { children: ComponentChildren; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(onClose, 200);
  };

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    let drag: { y0: number; x0: number; t0: number; pointerId: number; active: boolean; dy: number } | null = null;
    const setY = (y: number, animate: boolean) => {
      el.style.transition = animate ? 'transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)' : 'none';
      el.style.transform = y ? `translateY(${y}px)` : '';
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (t.closest('input, textarea, select, .sheet')) return;
      const screen = el.querySelector<HTMLElement>('.screen');
      const fromBar = !!t.closest('.page-sheet-grab, .navbar');
      if (!fromBar && screen && screen.scrollTop > 0) return;
      drag = { y0: e.clientY, x0: e.clientX, t0: Date.now(), pointerId: e.pointerId, active: false, dy: 0 };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const dy = e.clientY - drag.y0;
      const dx = e.clientX - drag.x0;
      if (!drag.active) {
        if (dy < -6 || Math.abs(dx) > Math.abs(dy) + 4) {
          drag = null;
          return;
        }
        if (dy > 8) drag.active = true;
        else return;
      }
      drag.dy = Math.max(0, dy);
      setY(drag.dy, false);
    };
    const onUp = () => {
      if (!drag) return;
      const { active, dy, t0 } = drag;
      drag = null;
      if (!active) return;
      const fast = dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.6;
      if (dy > CLOSE_PX || fast) {
        setY(el.clientHeight, true);
        closingRef.current = true;
        setTimeout(onClose, 200);
      } else {
        setY(0, true);
      }
    };
    // While the sheet follows the finger, the content must not scroll or bounce.
    const onTouchMove = (e: TouchEvent) => {
      if (drag?.active) e.preventDefault();
    };
    // A drag that ended over a button must not also press it.
    const onClick = (e: MouseEvent) => {
      if (el.style.transform) e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.sheet') && close();
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div class={`page-sheet-backdrop${closing ? ' closing' : ''}`} onClick={(e) => e.target === e.currentTarget && close()}>
      <div class={`page-sheet${closing ? ' closing' : ''}`} ref={panel} role="dialog" aria-modal="true">
        <div class="page-sheet-grab" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
