/**
 * Thin Fullscreen API wrapper. Best-effort only: the brief calls for
 * "full-screen where available, and degrade gracefully to the existing
 * presentation mode's chrome-hiding when denied or unsupported" — so every
 * function here resolves/returns normally on failure rather than throwing.
 * Cinematic mode's chrome-hiding is driven independently (via the existing
 * `presentation` app-state flag), so a fullscreen failure never blocks entry.
 *
 * `HTMLElement.requestFullscreen`/`Document.exitFullscreen`/
 * `Document.fullscreenElement` are standard and already typed by `lib.dom`;
 * only the legacy WebKit-prefixed fallbacks need their own (optional) typing.
 */

interface WebkitFullscreenElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

interface WebkitFullscreenDocument {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
}

export function isFullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement as unknown as WebkitFullscreenElement;
  return typeof document.documentElement.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}

export function isFullscreenActive(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as unknown as WebkitFullscreenDocument;
  return Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement);
}

/** Best-effort request. Resolves `true` on success, `false` on any failure
 *  (denied, unsupported, not a real user gesture in some browsers, ...). */
export async function requestFullscreen(el: HTMLElement = document.documentElement): Promise<boolean> {
  const legacy = el as unknown as WebkitFullscreenElement;
  try {
    if (typeof el.requestFullscreen === 'function') {
      await el.requestFullscreen();
      return true;
    }
    if (typeof legacy.webkitRequestFullscreen === 'function') {
      await legacy.webkitRequestFullscreen();
      return true;
    }
  } catch {
    // Denied, blocked, or not invoked from a user gesture — fall back to
    // presentation mode's chrome-hiding, which the caller already applies
    // regardless of this result.
  }
  return false;
}

export async function exitFullscreen(): Promise<void> {
  const doc = document as unknown as WebkitFullscreenDocument;
  try {
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      await document.exitFullscreen();
    } else if (doc.webkitFullscreenElement && typeof doc.webkitExitFullscreen === 'function') {
      await doc.webkitExitFullscreen();
    }
  } catch {
    // Nothing more we can do; the app-level chrome-hiding still reverts.
  }
}
