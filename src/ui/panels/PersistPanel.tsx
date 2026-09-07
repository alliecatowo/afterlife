/**
 * Save & export. Named saves, JSON experiment interchange, RLE pattern
 * interchange and PNG export (world + sculpture) all live here, all backed
 * by the real `@/persist` module and `session.buildExperimentDoc` /
 * `applyExperimentDoc` — nothing here fabricates a document. Reseeding or
 * clearing the world never touches named saves (they live under separate
 * `afterlife:v1:save:*` keys); only the explicit "reset all local data"
 * button below calls `persist.clearAll()`.
 */
import { useRef, useState } from 'react';
import { getSession, WORLD_SPEC } from '@/ui/session';
import { useAppStore } from '@/ui/store';
import { bus } from '@/ui/bus';
import { exportExperiment, fromRLE, importExperiment, PersistQuotaError, toRLE } from '@/persist/store';
import { Button, Divider, Field } from '@/ui/primitives';
import { DownloadIcon, UploadIcon } from '@/ui/icons';

function download(filename: string, content: string | Blob, mime = 'text/plain'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function PersistPanel() {
  const session = getSession();
  const sculptureOpen = useAppStore((s) => s.sculptureOpen);
  const selection = useAppStore((s) => s.selection);
  const [saves, setSaves] = useState(() => session?.persist.list() ?? []);
  const [title, setTitle] = useState('Untitled');
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const rleInputRef = useRef<HTMLInputElement>(null);

  const refresh = (): void => setSaves(session?.persist.list() ?? []);
  const effectiveTitle = (): string => title.trim() || 'Untitled';

  const saveAs = (): void => {
    if (!session) return;
    const doc = session.buildExperimentDoc(effectiveTitle());
    try {
      session.persist.saveAs(`save-${Date.now()}`, doc);
      refresh();
      bus.emit('toast', { message: `Saved "${doc.title}".`, tone: 'success' });
    } catch (err) {
      if (!(err instanceof PersistQuotaError)) bus.emit('toast', { message: 'Could not save — see the console for details.', tone: 'warn' });
    }
  };

  const load = (id: string): void => {
    const doc = session?.persist.loadFrom(id);
    if (!doc) { bus.emit('toast', { message: 'That save could not be read.', tone: 'warn' }); return; }
    session?.applyExperimentDoc(doc);
  };

  const remove = (id: string): void => {
    session?.persist.remove(id);
    refresh();
  };

  const exportJson = (): void => {
    if (!session) return;
    const doc = session.buildExperimentDoc(effectiveTitle());
    download(`${doc.title.replace(/\s+/g, '-').toLowerCase()}.afterlife.json`, exportExperiment(doc), 'application/json');
  };

  const importJson = (file: File): void => {
    if (!session) return;
    void file.text().then((text) => {
      try {
        session.applyExperimentDoc(importExperiment(text));
      } catch (err) {
        bus.emit('toast', { message: `Could not import: ${(err as Error).message}`, tone: 'warn' });
      }
    });
  };

  const exportRle = (): void => {
    if (!session) return;
    const rect = selection ?? { x: 0, y: 0, w: WORLD_SPEC.width, h: WORLD_SPEC.height };
    const cells = session.engine.region(rect);
    download(`${effectiveTitle().replace(/\s+/g, '-').toLowerCase()}.rle`, toRLE(cells, rect, effectiveTitle()), 'text/plain');
  };

  const importRle = (file: File): void => {
    if (!session) return;
    void file.text().then((text) => {
      try {
        const parsed = fromRLE(text);
        const origin = selection ?? {
          x: Math.floor(session.camera.camera.x - parsed.w / 2),
          y: Math.floor(session.camera.camera.y - parsed.h / 2),
        };
        const cells: Array<{ x: number; y: number; alive: boolean }> = [];
        for (let y = 0; y < parsed.h; y++) {
          for (let x = 0; x < parsed.w; x++) {
            cells.push({ x: origin.x + x, y: origin.y + y, alive: parsed.cells[y * parsed.w + x] === 1 });
          }
        }
        session.applyEdit({ kind: 'set', cells });
        bus.emit('toast', { message: `Imported "${parsed.name}".`, tone: 'success' });
      } catch (err) {
        bus.emit('toast', { message: `Could not import RLE: ${(err as Error).message}`, tone: 'warn' });
      }
    });
  };

  const exportWorldPng = (): void => {
    session?.renderer.exportImage().then((blob) => download('afterlife-world.png', blob)).catch(() => {
      bus.emit('toast', { message: 'Could not export the world image.', tone: 'warn' });
    });
  };

  const exportSculpturePng = (): void => {
    session?.sculpture.exportPng({ rule: 'B3/S23' }).then((blob) => download('afterlife-sculpture.png', blob)).catch(() => {
      bus.emit('toast', { message: 'Could not export the sculpture image — is it open?', tone: 'warn' });
    });
  };

  const resetAllData = (): void => {
    if (!window.confirm('Delete every AFTERLIFE save from this browser? This cannot be undone.')) return;
    session?.persist.clearAll();
    refresh();
    bus.emit('toast', { message: 'All local saves cleared.', tone: 'warn' });
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label="Title">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-xs border border-line-strong bg-ink-900 px-2 py-1 text-sm text-ivory-100 focus-visible:focus-ring outline-none"
        />
      </Field>

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="ghost" onClick={saveAs}>Save as new</Button>
        <Button size="sm" variant="ghost" onClick={exportJson}><DownloadIcon /> Export JSON</Button>
        <Button size="sm" variant="ghost" onClick={() => jsonInputRef.current?.click()}><UploadIcon /> Import JSON</Button>
        <input
          ref={jsonInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ''; }}
        />
      </div>

      <Divider />

      <div className="flex flex-col gap-1.5">
        <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">Named saves</span>
        {saves.length === 0 ? (
          <p className="text-xs text-ivory-300">Nothing saved yet in this browser.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {saves.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-sm border border-line px-2 py-1.5">
                <span className="min-w-0 truncate text-xs text-ivory-100">{s.title}</span>
                <span className="flex shrink-0 gap-1">
                  <Button size="sm" variant="quiet" onClick={() => load(s.id)}>Load</Button>
                  <Button size="sm" variant="quiet" onClick={() => remove(s.id)}>Delete</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Divider />

      <div className="flex flex-col gap-1.5">
        <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">Patterns (RLE)</span>
        <p className="text-xs text-ivory-300">
          {selection
            ? `Exports the current selection (${selection.w}×${selection.h}).`
            : 'Exports the whole world — draw a selection to narrow it.'}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={exportRle}><DownloadIcon /> Export RLE</Button>
          <Button size="sm" variant="ghost" onClick={() => rleInputRef.current?.click()}><UploadIcon /> Import RLE</Button>
          <input
            ref={rleInputRef}
            type="file"
            accept=".rle,text/plain"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importRle(f); e.target.value = ''; }}
          />
        </div>
      </div>

      <Divider />

      <div className="flex flex-col gap-1.5">
        <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">Images</span>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={exportWorldPng}><DownloadIcon /> Export world PNG</Button>
          {sculptureOpen && (
            <Button size="sm" variant="ghost" onClick={exportSculpturePng}><DownloadIcon /> Export sculpture PNG</Button>
          )}
        </div>
      </div>

      <Divider />

      <Button size="sm" variant="ghost" onClick={resetAllData} style={{ color: 'var(--color-accent-warn)' }}>
        Reset all local data
      </Button>
    </div>
  );
}
