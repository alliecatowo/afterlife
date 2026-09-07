/**
 * Lightweight, always-in-the-main-bundle loading placeholder shown the
 * instant the Time Sculpture host mounts, while `sculpture.tsx` dynamically
 * imports the real `SculptureApp` chunk (three.js + @react-three/fiber +
 * drei — see ARCHITECTURE.md's "React never re-renders per generation" /
 * bundle-size note). No three.js, no heavy deps: keeping this component
 * cheap is exactly what lets the core experience boot without paying for a
 * feature most sessions never open. Same tone as `./Fallback2D`'s
 * `WebGLUnsupportedNotice` — an editorial Fraunces line, a hairline instead
 * of a spinner, ink/ivory tokens only.
 */
export function SculptureLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: 'var(--color-ink-900)',
        padding: 24,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-lg)',
          color: 'var(--color-ivory-100)',
          textAlign: 'center',
        }}
      >
        Assembling the time sculpture
      </div>
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-ivory-300)',
          textAlign: 'center',
          maxWidth: 320,
        }}
      >
        Extruding recorded history into a volume you can orbit.
      </div>
      <div
        aria-hidden="true"
        style={{
          width: 160,
          height: 1,
          background: 'var(--color-line)',
          position: 'relative',
          overflow: 'hidden',
          marginTop: 4,
        }}
      >
        <div
          className="sculpture-loading-sweep"
          style={{ position: 'absolute', top: 0, bottom: 0, width: '40%', background: 'var(--color-accent-time)' }}
        />
      </div>
    </div>
  );
}
