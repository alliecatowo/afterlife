/**
 * The self-mounted Art mode entry point — see `artMount.ts`'s doc for why
 * this exists outside the normal HUD/panel tree for now. A small quiet tab
 * (never a floating card over the world, per DESIGN.md §6 — this is a
 * fixed-edge affordance, same idea as the achievements logbook's original
 * trigger) that toggles Art mode directly on click (one action = the whole
 * world flips into its last-used Art config, or Classic ASCII the very
 * first time), plus a gear button that opens the full `ArtPanel` in a
 * `Dialog`.
 */
import { lazy, Suspense, useState } from 'react';
import { useArtStore } from './artStore';
import { Dialog, IconButton, Tooltip } from '@/ui/primitives';

// Lazy-imported so this tiny always-mounted trigger doesn't pull the whole
// (much larger) `ArtPanel` — with every primitive, `mediaField`, preset, and
// LFO control it depends on — into the initial bundle just to render a
// single button; it's only needed once the Dialog actually opens.
const ArtPanelLazy = lazy(() => import('@/ui/panels/ArtPanel').then((m) => ({ default: m.ArtPanel })));

function AsciiGlyphIcon() {
  return (
    <span aria-hidden="true" className="font-mono text-[13px] leading-none" style={{ letterSpacing: '-0.05em' }}>
      #%
    </span>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.25" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.5v1.4M8 13.1v1.4M14.5 8h-1.4M2.9 8H1.5M12.5 3.5l-1 1M4.5 11.5l-1 1M12.5 12.5l-1-1M4.5 4.5l-1-1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ArtTrigger() {
  const enabled = useArtStore((s) => s.config.enabled);
  const toggleEnabled = useArtStore((s) => s.toggleEnabled);
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <div
      className="fixed bottom-3 left-3 z-[var(--z-overlay)] flex items-center gap-1 rounded-sm border border-line bg-surface px-1.5 py-1 shadow-[var(--shadow-hairline)]"
      style={{ zIndex: 40 }}
    >
      <Tooltip content={enabled ? 'Turn off Art mode (A)' : 'Turn on Art mode — Classic ASCII (A)'}>
        <IconButton
          label={enabled ? 'Turn off Art mode' : 'Turn on Art mode'}
          icon={<AsciiGlyphIcon />}
          pressed={enabled}
          onClick={() => toggleEnabled()}
        />
      </Tooltip>
      <Tooltip content="Art mode settings">
        <IconButton label="Art mode settings" icon={<GearIcon />} onClick={() => setPanelOpen(true)} />
      </Tooltip>
      <Dialog open={panelOpen} onOpenChange={setPanelOpen} title="Acid Art" description="Glyphs, the modulation field, LFO automation, and colour — all layered on top of the honest simulation." width={480}>
        <Suspense fallback={<p className="text-xs text-ivory-300">Loading…</p>}>
          <ArtPanelLazy />
        </Suspense>
      </Dialog>
    </div>
  );
}
