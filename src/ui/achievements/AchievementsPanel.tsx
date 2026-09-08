/**
 * The logbook itself — a quiet list, not a trophy case. Earned rows show the
 * generation and real timestamp they were earned at (mirroring how
 * `@/content/discoveries` shows a sighting's generation) and, where the
 * achievement is tied to a specific place in the world, a "Go to this
 * moment" link back to it, exactly like a Field Guide entry's own "go to"
 * affordance. Unearned rows stay visible but muted (`text-ink-500`, per
 * DESIGN.md's disabled-state treatment) with the SAME honest description —
 * never a locked riddle, never hidden entirely.
 */
import { Dialog } from '@/ui/primitives';
import { logbookRows } from '@/content/achievements';
import { useAchievements, goToAchievement } from './store';

function formatWhen(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export interface AchievementsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AchievementsPanel({ open, onOpenChange }: AchievementsPanelProps) {
  const log = useAchievements((s) => s.log);
  const rows = logbookRows(log);
  const earnedCount = rows.filter((r) => r.earned !== null).length;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Logbook"
      description={`${earnedCount} of ${rows.length} entries recorded.`}
      width={480}
    >
      <ul className="flex flex-col gap-0">
        {rows.map(({ def, earned }, i) => (
          <li key={def.id} className={i > 0 ? 'border-t border-line pt-3 mt-3' : ''}>
            <div className="flex items-start justify-between gap-3">
              <p className={'display-face-tight text-base ' + (earned ? 'text-ivory-100' : 'text-ink-500')}>
                {def.title}
              </p>
              {earned && (
                <span className="tabular whitespace-nowrap text-micro uppercase tracking-[0.18em] text-ivory-300">
                  gen {earned.gen}
                </span>
              )}
            </div>
            <p className={'mt-1 text-sm ' + (earned ? 'text-ivory-200' : 'text-ink-500')}>{def.description}</p>
            {earned && (
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <span className="tabular text-micro text-ivory-300">{formatWhen(earned.at)}</span>
                {earned.rect && (
                  <button
                    type="button"
                    className="text-micro uppercase tracking-[0.18em] text-ivory-300 underline decoration-line-strong underline-offset-2 hover:text-ivory-100 focus-visible:focus-ring"
                    onClick={() => goToAchievement(def.id)}
                  >
                    Go to this moment
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
