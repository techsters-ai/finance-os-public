// Hash router: works on GitHub Pages without server-side rewrites.
import { signal } from '@preact/signals';

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

export function parse(hash: string): Route {
  // No hash = the app was just opened: start on the board (Home is '#/').
  const raw = hash.replace(/^#/, '') || '/board';
  const [p, q = ''] = raw.split('?');
  const path = p.startsWith('/') ? p : `/${p}`;
  return { path, segments: path.split('/').filter(Boolean), query: new URLSearchParams(q) };
}

export const route = signal<Route>(parse(typeof location !== 'undefined' ? location.hash : ''));

/** Number of in-app navigations: tells whether history.back() stays inside the app. */
let depth = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    route.value = parse(location.hash);
  });
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const hash = `#${to}`;
  if (opts.replace) {
    history.replaceState(null, '', hash);
    route.value = parse(hash);
    return;
  }
  depth++;
  location.hash = to;
}

export function back(fallback = '/'): void {
  if (depth > 0) {
    depth--;
    history.back();
  } else {
    navigate(fallback, { replace: true });
  }
}

/**
 * Steps back through history until `done` holds (closing a stack of sheets at once); without in-app history
 * it replaces the route with `fallback`.
 */
export function backUntil(done: (r: Route) => boolean, fallback: string): void {
  if (done(route.value)) return;
  if (depth <= 0) {
    navigate(fallback, { replace: true });
    return;
  }
  const onChange = () => {
    if (done(route.value)) {
      window.removeEventListener('hashchange', onChange);
    } else if (depth <= 0) {
      window.removeEventListener('hashchange', onChange);
      navigate(fallback, { replace: true });
    } else {
      depth--;
      history.back();
    }
  };
  window.addEventListener('hashchange', onChange);
  depth--;
  history.back();
}

export function href(to: string): string {
  return `#${to}`;
}
