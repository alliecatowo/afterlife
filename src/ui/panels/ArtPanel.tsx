/**
 * ACID ART — Art mode's full control surface. Owned by the `render` agent
 * (per this feature's file-ownership brief; the surrounding right-panel
 * shell (`PanelRight.tsx`) and HUD reachability are proposed as an exact
 * diff in `INTEGRATION-NOTES.md` rather than edited directly here, since
 * those files are outside this agent's assigned ownership for this pass).
 *
 * Every control here writes to `@/render/artStore`, which `@/render/
 * renderer.ts`'s `setArtConfig`/`setModulationGrid` consume — nothing in
 * this file touches the simulation. See that store/renderer's own docs for
 * the honesty guarantees (Art mode is decoration on top of the real lenses,
 * never a second source of truth for which cells are alive).
 *
 * Reachable today via `@/render/artMount.ts`'s self-mounted trigger tab +
 * the `a` keyboard shortcut (both wired from `WorldRenderer.attach()`, which
 * this agent owns) — see that file's doc for why, and INTEGRATION-NOTES.md
 * for the proposed permanent home (a HUD icon button, matching `Instrument`/
 * `Settings`).
 */
import { useEffect, useRef, useState } from 'react';
import { bus } from '@/ui/bus';
import { getSession } from '@/ui/session';
import { useReducedMotion } from '@/ui/hooks/useReducedMotion';
import { Button, Divider, Field, Slider, Toggle } from '@/ui/primitives';
import { useArtStore } from '@/render/artStore';
import { GLYPH_MIN_SCALE } from '@/render/renderer';
import {
  GLYPH_DRIVERS, GLYPH_DRIVER_LABELS, GLYPH_SET_LABELS, MAX_CUSTOM_GLYPHS, MIN_CUSTOM_GLYPHS,
} from '@/render/glyphs';
import { FIELD_SOURCES, type FieldSourceId } from '@/render/field';
import { FIELD_TARGETS, ART_PRESETS, MAX_LFOS, MAX_PALETTE_STOPS, MIN_PALETTE_STOPS, LFO_TARGETS } from '@/render/artConfig';
import { LFO_SHAPES } from '@/render/lfo';
import { MediaFieldSource, thresholdToBits } from '@/render/mediaField';
import type { FieldTarget, LfoTarget } from '@/render/artConfig';

const GLYPH_SET_OPTIONS = (['ascii', 'blocks', 'box', 'dots', 'geometric', 'custom'] as const)
  .map((id) => ({ value: id, label: GLYPH_SET_LABELS[id] }));

const DRIVER_OPTIONS = GLYPH_DRIVERS.map((d) => ({ value: d, label: GLYPH_DRIVER_LABELS[d] }));

const FIELD_SOURCE_LABELS: Record<FieldSourceId, string> = {
  none: 'None',
  perlin: 'Perlin-like noise',
  simplex: 'Simplex-like noise',
  radial: 'Radial',
  linear: 'Linear',
  plasma: 'Plasma (animated)',
  image: 'Image',
  video: 'Video file',
  webcam: 'Webcam',
};
const FIELD_SOURCE_OPTIONS = FIELD_SOURCES.map((s) => ({ value: s, label: FIELD_SOURCE_LABELS[s] }));

const FIELD_TARGET_LABELS: Record<FieldTarget, string> = {
  glyph: 'Glyph', hue: 'Hue', brightness: 'Brightness', jitter: 'Jitter',
};
const FIELD_TARGET_OPTIONS = FIELD_TARGETS.map((t) => ({ value: t, label: FIELD_TARGET_LABELS[t] }));

const LFO_SHAPE_OPTIONS = LFO_SHAPES.map((s) => ({ value: s, label: s === 'randomWalk' ? 'Random walk' : s[0]!.toUpperCase() + s.slice(1) }));

const LFO_TARGET_LABELS: Record<LfoTarget, string> = {
  none: 'None', hueRotate: 'Hue rotation', paletteCycle: 'Palette cycle', glyphSetIndex: 'Glyph set',
  fieldScale: 'Field scale', fieldOffsetX: 'Field offset X', fieldOffsetY: 'Field offset Y',
  fieldRotation: 'Field rotation', trailLength: 'Trail length', brightness: 'Brightness',
};
const LFO_TARGET_OPTIONS = LFO_TARGETS.map((t) => ({ value: t, label: LFO_TARGET_LABELS[t] }));

function useCameraScale(): number {
  const [scale, setScale] = useState(() => getSession()?.camera.camera.scale ?? 8);
  useEffect(() => bus.on('camera:changed', (p) => setScale(p.scale)).dispose, []);
  return scale;
}

export function ArtPanel() {
  const config = useArtStore((s) => s.config);
  const toggleEnabled = useArtStore((s) => s.toggleEnabled);
  const updateGlyphs = useArtStore((s) => s.updateGlyphs);
  const updateField = useArtStore((s) => s.updateField);
  const setLfos = useArtStore((s) => s.setLfos);
  const addLfo = useArtStore((s) => s.addLfo);
  const updateLfo = useArtStore((s) => s.updateLfo);
  const removeLfo = useArtStore((s) => s.removeLfo);
  const updateColor = useArtStore((s) => s.updateColor);
  const applyPreset = useArtStore((s) => s.applyPreset);
  const applyClassicAscii = useArtStore((s) => s.applyClassicAscii);
  const randomize = useArtStore((s) => s.randomize);
  const reset = useArtStore((s) => s.reset);
  const importConfig = useArtStore((s) => s.importConfig);
  const exportConfig = useArtStore((s) => s.exportConfig);

  const reducedMotion = useReducedMotion();
  const scale = useCameraScale();
  const glyphsLegible = scale >= GLYPH_MIN_SCALE;

  const mediaRef = useRef<MediaFieldSource | null>(null);
  const [mediaState, setMediaState] = useState<'idle' | 'image' | 'video' | 'webcam' | 'error'>('idle');
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [seedThreshold, setSeedThreshold] = useState(0.5);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const seedFileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const getMedia = (): MediaFieldSource => {
    if (!mediaRef.current) mediaRef.current = new MediaFieldSource();
    return mediaRef.current;
  };

  // Poll the media source's sampled grid onto the renderer at ~12fps while
  // any media source is active — decoupled from React state on purpose (the
  // grid is a plain Float32Array pushed straight to the renderer, never
  // through `setState`, matching this codebase's "no setState per frame"
  // rule for anything performance-sensitive).
  useEffect(() => {
    if (mediaState === 'idle' || mediaState === 'error') return undefined;
    const id = window.setInterval(() => {
      const renderer = getSession()?.renderer;
      const grid = mediaRef.current?.getGrid() ?? null;
      renderer?.setModulationGrid(grid);
    }, 80);
    return () => window.clearInterval(id);
  }, [mediaState]);

  // A forgotten live camera is a serious problem — full teardown on
  // unmount, regardless of how the panel was closed.
  useEffect(() => () => {
    mediaRef.current?.dispose();
    getSession()?.renderer.setModulationGrid(null);
  }, []);

  const onPickImage = async (file: File) => {
    const media = getMedia();
    await media.loadImage(file);
    setMediaState(media.state.kind === 'error' ? 'error' : 'image');
    setMediaError(media.state.kind === 'error' ? media.state.message : null);
    updateField({ source: 'image' });
  };

  const onPickVideo = async (file: File) => {
    const media = getMedia();
    await media.loadVideoFile(file);
    setMediaState(media.state.kind === 'error' ? 'error' : 'video');
    setMediaError(media.state.kind === 'error' ? media.state.message : null);
    updateField({ source: 'video' });
  };

  const onStartWebcam = async () => {
    const media = getMedia();
    await media.startWebcam();
    setMediaState(media.state.kind === 'error' ? 'error' : 'webcam');
    setMediaError(media.state.kind === 'error' ? media.state.message : null);
    if (media.state.kind === 'webcam') updateField({ source: 'webcam' });
  };

  const onStopMedia = () => {
    mediaRef.current?.stop();
    setMediaState('idle');
    setMediaError(null);
    getSession()?.renderer.setModulationGrid(null);
    if (config.field.source === 'image' || config.field.source === 'video' || config.field.source === 'webcam') {
      updateField({ source: 'none' });
    }
  };

  const onSeedFromImage = async (file: File) => {
    const session = getSession();
    if (!session) return;
    const { width, height } = session.engine.spec;
    const media = getMedia();
    const { data, w, h } = await media.imagePixelsAt(file, width, height);
    const bits = thresholdToBits(data, w, h, seedThreshold);
    const cells: Array<{ x: number; y: number; alive: boolean }> = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) cells.push({ x, y, alive: bits[y * w + x] === 1 });
    }
    session.applyEdit({ kind: 'set', cells });
  };

  const onExport = () => {
    const blob = new Blob([exportConfig()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'afterlife-art-config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (file: File) => {
    const text = await file.text();
    importConfig(text);
  };

  return (
    <div className="flex flex-col gap-5">
      <Field
        label="ACID ART — Art mode"
        description="A decorative layer on top of the real simulation: it never changes which cells are alive, only how they look. Every honest lens (life/age/activity/…) is completely unaffected — turn this off and rendering is exactly as it was."
      >
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-ivory-200 max-[480px]:min-h-11">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={() => toggleEnabled()}
              className="h-3.5 w-3.5 shrink-0 accent-[var(--color-ivory-100)] max-[480px]:h-5 max-[480px]:w-5"
            />
            Enable Art mode
          </label>
          <Button size="sm" variant="ghost" onClick={() => applyClassicAscii()}>Classic ASCII (one click)</Button>
        </div>
        <p className="text-xs text-ivory-300">
          Keyboard shortcut: <span className="tabular text-ivory-100">A</span>. {glyphsLegible
            ? 'Zoomed in enough — glyphs are visible now.'
            : `Zoom in further to see glyphs (needs ${GLYPH_MIN_SCALE}px/cell or more; you're at ${Math.round(scale)}px/cell — below that, the honest lens renders unmodified).`}
        </p>
      </Field>

      <Divider />

      <Field label="Presets">
        <div className="flex flex-wrap gap-1.5">
          {ART_PRESETS.map((p) => (
            <Button key={p.id} size="sm" variant="ghost" title={p.description} onClick={() => applyPreset(p.id, reducedMotion)}>
              {p.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => randomize(reducedMotion)}>Randomise</Button>
          <Button size="sm" variant="ghost" onClick={() => reset()} style={{ color: 'var(--color-accent-warn)' }}>Reset</Button>
        </div>
      </Field>

      <Divider />

      <Field label="Glyphs" description="Which character a live cell gets — always driven by real per-cell state, never invented.">
        <Toggle aria-label="Glyph set" size="sm" options={GLYPH_SET_OPTIONS} value={config.glyphs.setId} onChange={(v) => updateGlyphs({ setId: v })} />
        {config.glyphs.setId === 'custom' && (
          <label className="flex flex-col gap-1 text-xs text-ivory-200">
            Custom characters, low → high intensity ({MIN_CUSTOM_GLYPHS}–{MAX_CUSTOM_GLYPHS})
            <input
              type="text"
              value={config.glyphs.customChars}
              onChange={(e) => updateGlyphs({ customChars: e.target.value.slice(0, MAX_CUSTOM_GLYPHS) })}
              className="w-full rounded-xs border border-line-strong bg-ink-900 px-2 py-1.5 font-mono text-sm text-ivory-100 focus-visible:focus-ring outline-none"
            />
          </label>
        )}
        <Toggle aria-label="Glyph driver" size="sm" options={DRIVER_OPTIONS} value={config.glyphs.driver} onChange={(v) => updateGlyphs({ driver: v })} />
      </Field>

      <Divider />

      <Field label="Modulation field" description="An acid image behind the world: a noise field, gradient, or a real image/video/webcam frame, sampled per cell to nudge glyph choice, hue, brightness, or jitter.">
        <Toggle aria-label="Field source" size="sm" options={FIELD_SOURCE_OPTIONS} value={config.field.source} onChange={(v) => updateField({ source: v })} />
        {config.field.source !== 'none' && (
          <>
            <Toggle aria-label="Field targets" type="multiple" size="sm" options={FIELD_TARGET_OPTIONS} value={[...config.field.targets]} onChange={(v) => updateField({ targets: v })} />
            <Slider label="Scale" value={config.field.scale} min={0.05} max={10} step={0.05} onChange={(v) => updateField({ scale: v })} format={(v) => v.toFixed(2)} />
            <Slider label="Offset X" value={config.field.offsetX} min={-100} max={100} step={1} onChange={(v) => updateField({ offsetX: v })} />
            <Slider label="Offset Y" value={config.field.offsetY} min={-100} max={100} step={1} onChange={(v) => updateField({ offsetY: v })} />
            <Slider label="Rotation" value={config.field.rotationDeg} min={0} max={360} step={1} onChange={(v) => updateField({ rotationDeg: v })} format={(v) => `${v}°`} />
            <Slider label="Seed" value={config.field.seed} min={0} max={999} step={1} onChange={(v) => updateField({ seed: v })} />
          </>
        )}

        {(config.field.source === 'image' || config.field.source === 'video' || config.field.source === 'webcam') && (
          <div className="flex flex-col gap-2 rounded-sm border border-line p-2.5">
            <p className="text-xs text-ivory-300">
              The webcam requires your explicit permission and only ever feeds this cosmetic field — never the
              simulation. It stops the instant you click Stop, close this panel, or leave the page; no stream is
              ever left running unattended.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()}>Choose image…</Button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickImage(f); e.target.value = ''; }} />
              <Button size="sm" variant="ghost" onClick={() => videoInputRef.current?.click()}>Choose video…</Button>
              <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickVideo(f); e.target.value = ''; }} />
              {mediaState !== 'webcam' && <Button size="sm" variant="ghost" onClick={() => void onStartWebcam()}>Start webcam</Button>}
              {mediaState !== 'idle' && <Button size="sm" variant="ghost" onClick={onStopMedia} style={{ color: 'var(--color-accent-warn)' }}>Stop</Button>}
            </div>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (!f) return;
                if (f.type.startsWith('video/')) void onPickVideo(f); else void onPickImage(f);
              }}
              className="rounded-sm border border-dashed border-line px-3 py-4 text-center text-xs text-ivory-300"
            >
              …or drag an image/video file here
            </div>
            {mediaState === 'error' && mediaError && <p className="text-xs text-accent-warn">{mediaError}</p>}
            {mediaState !== 'idle' && mediaState !== 'error' && <p className="text-xs text-ivory-200">Active: {mediaState}.</p>}

            <Divider />
            <p className="text-xs text-ivory-300">Honest on-ramp: threshold this image's brightness straight into live cells (replaces the current world).</p>
            <Slider label="Seed threshold" value={seedThreshold} min={0} max={1} step={0.01} onChange={setSeedThreshold} format={(v) => v.toFixed(2)} />
            <Button size="sm" variant="ghost" onClick={() => seedFileInputRef.current?.click()}>Choose image to seed the world…</Button>
            <input
              ref={seedFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onSeedFromImage(f); e.target.value = ''; }}
            />
          </div>
        )}
      </Field>

      <Divider />

      <Field label="LFO automation" description="Values that drift over time — sine/triangle/saw/random-walk, each assignable to a parameter. Deterministic: the same moment in time always looks the same.">
        {reducedMotion && <p className="text-xs text-accent-warn">Reduced motion is on — LFO rates are slowed automatically when applying a preset or randomising.</p>}
        {config.lfos.map((lfo) => (
          <div key={lfo.id} className="flex flex-col gap-1.5 rounded-sm border border-line p-2">
            <div className="flex items-center justify-between gap-2">
              <Toggle aria-label="LFO shape" size="sm" options={LFO_SHAPE_OPTIONS} value={lfo.shape} onChange={(v) => updateLfo(lfo.id, { shape: v })} />
              <Button size="sm" variant="quiet" onClick={() => removeLfo(lfo.id)} style={{ color: 'var(--color-accent-warn)' }}>Remove</Button>
            </div>
            <Field label="Target" htmlFor={`lfo-target-${lfo.id}`}>
              <select
                id={`lfo-target-${lfo.id}`}
                value={lfo.target}
                onChange={(e) => updateLfo(lfo.id, { target: e.target.value as LfoTarget })}
                className="w-full rounded-xs border border-line-strong bg-ink-900 px-2 py-1.5 text-sm text-ivory-100 focus-visible:focus-ring outline-none max-[480px]:min-h-11"
              >
                {LFO_TARGET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Slider label="Rate" value={lfo.rateHz} min={0.01} max={4} step={0.01} onChange={(v) => updateLfo(lfo.id, { rateHz: v })} format={(v) => `${v.toFixed(2)} Hz`} />
            <Slider label="Depth" value={lfo.depth} min={0} max={1} step={0.01} onChange={(v) => updateLfo(lfo.id, { depth: v })} format={(v) => v.toFixed(2)} />
          </div>
        ))}
        <Button size="sm" variant="ghost" disabled={config.lfos.length >= MAX_LFOS} onClick={() => addLfo()}>Add LFO ({config.lfos.length}/{MAX_LFOS})</Button>
        {config.lfos.length > 0 && <Button size="sm" variant="quiet" onClick={() => setLfos([])}>Clear all</Button>}
      </Field>

      <Divider />

      <Field label="Colour" description="Custom palettes, hue rotation, palette cycling, and trails — trails show PAST state fading in, never a live thing.">
        <Toggle
          aria-label="Colour source"
          size="sm"
          options={[{ value: 'lens', label: 'Active lens' }, { value: 'custom', label: 'Custom palette' }]}
          value={config.color.source}
          onChange={(v) => updateColor({ source: v })}
        />
        {config.color.source === 'custom' && (
          <div className="flex flex-col gap-1.5">
            {config.color.stops.map((stop, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(stop.color) ? stop.color : '#888888'}
                  onChange={(e) => {
                    const stops = config.color.stops.map((s, j) => (j === i ? { ...s, color: e.target.value } : s));
                    updateColor({ stops });
                  }}
                  className="h-7 w-10 shrink-0 cursor-pointer rounded-xs border border-line-strong bg-transparent"
                  aria-label={`Palette stop ${i + 1} colour`}
                />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={stop.t}
                  onChange={(e) => {
                    const stops = config.color.stops.map((s, j) => (j === i ? { ...s, t: Number(e.target.value) } : s));
                    updateColor({ stops });
                  }}
                  className="flex-1"
                  aria-label={`Palette stop ${i + 1} position`}
                />
                <span className="tabular w-10 text-right text-xs text-ivory-300">{stop.t.toFixed(2)}</span>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={config.color.stops.length <= MIN_PALETTE_STOPS}
                  onClick={() => updateColor({ stops: config.color.stops.filter((_, j) => j !== i) })}
                >
                  ×
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              disabled={config.color.stops.length >= MAX_PALETTE_STOPS}
              onClick={() => updateColor({ stops: [...config.color.stops, { t: 1, color: '#ffffff' }] })}
            >
              Add stop ({config.color.stops.length}/{MAX_PALETTE_STOPS})
            </Button>
          </div>
        )}
        <Slider label="Hue rotation" value={config.color.hueRotateDeg} min={0} max={360} step={1} onChange={(v) => updateColor({ hueRotateDeg: v })} format={(v) => `${v}°`} />
        <Slider label="Palette cycle speed" value={config.color.cycleSpeedHz} min={0} max={2} step={0.01} onChange={(v) => updateColor({ cycleSpeedHz: v })} format={(v) => `${v.toFixed(2)} Hz`} />
        <Divider />
        <label className="flex items-center gap-2 text-xs text-ivory-200 max-[480px]:min-h-11">
          <input
            type="checkbox"
            checked={config.color.trails.enabled}
            onChange={(e) => updateColor({ trails: { ...config.color.trails, enabled: e.target.checked } })}
            className="h-3.5 w-3.5 shrink-0 accent-[var(--color-ivory-100)] max-[480px]:h-5 max-[480px]:w-5"
          />
          Trails (fade in past state — not live data)
        </label>
        {config.color.trails.enabled && (
          <Slider label="Trail decay" value={config.color.trails.decay} min={0.02} max={0.8} step={0.01} onChange={(v) => updateColor({ trails: { ...config.color.trails, decay: v } })} format={(v) => v.toFixed(2)} />
        )}
      </Field>

      <Divider />

      <Field label="Save / load">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={onExport}>Export config…</Button>
          <Button size="sm" variant="ghost" onClick={() => importInputRef.current?.click()}>Import config…</Button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportFile(f); }}
          />
        </div>
        <p className="text-xs text-ivory-300">Also auto-saved to this browser as you go, the same way your other preferences are.</p>
      </Field>

      {!config.enabled && (
        <p className="text-xs text-ivory-300">
          Enable Art mode above to see any of this — the default look (used everywhere else in the app) is
          completely unaffected until you do.
        </p>
      )}
    </div>
  );
}
