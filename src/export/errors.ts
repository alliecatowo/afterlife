/** Thrown when a requested export format/codec genuinely isn't available in
 *  this browser — surfaced as an honest message, never a silently-broken file. */
export class ExportUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportUnsupportedError';
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
