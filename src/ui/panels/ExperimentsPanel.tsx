/**
 * The three authored challenges. Starting one seeds a fresh world from its
 * `SceneDef` (see `@/ui/experiments`); restart, intervention (draw/erase/
 * stamp) and time travel (the timeline ribbon) are the same controls used
 * everywhere else in AFTERLIFE — an experiment is just a `TimelineStore`
 * with a target generation and a pure evaluator. Success is reported as an
 * observation of the actual state, never a badge.
 */
import { EXPERIMENTS, type ExperimentVerdict, useExperiments } from '@/ui/experiments';
import { Button, Divider, Readout } from '@/ui/primitives';

function VerdictView({ verdict }: { verdict: ExperimentVerdict }) {
  if (verdict.kind === 'first-contact') {
    return (
      <p className="text-xs text-ivory-200">
        At generation <span className="tabular">{verdict.gen}</span>: {verdict.note}
      </p>
    );
  }
  if (verdict.kind === 'one-cell') {
    return (
      <p className="text-xs text-ivory-200">
        At generation <span className="tabular">{verdict.gen}</span>, the two worlds differ in{' '}
        <span className="tabular text-ivory-100">{verdict.divergentCells}</span> cells within the measurement
        region — {verdict.divergentCells === 0 ? 'still identical.' : 'they have visibly come apart.'}
      </p>
    );
  }
  return (
    <p className="text-xs text-ivory-200">
      {verdict.success
        ? `Alive the whole way to generation ${verdict.targetGen} — the quietest 8-generation window still saw ${verdict.minActivity} cells change.`
        : `It fell silent at generation ${verdict.failedAtGen ?? '?'}, before reaching ${verdict.targetGen}.`}
    </p>
  );
}

export function ExperimentsPanel() {
  const active = useExperiments((s) => s.active);
  const editCount = useExperiments((s) => s.editCount);
  const verdict = useExperiments((s) => s.verdict);
  const checking = useExperiments((s) => s.checking);
  const start = useExperiments((s) => s.start);
  const restart = useExperiments((s) => s.restart);
  const checkOutcome = useExperiments((s) => s.checkOutcome);
  const keepPlaying = useExperiments((s) => s.keepPlaying);
  const exit = useExperiments((s) => s.exit);

  if (!active) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-ivory-300">
          Three authored challenges. Starting one replaces the current world with its seed — your
          own world isn&rsquo;t lost, it&rsquo;s just not where you&rsquo;ll be looking.
        </p>
        <ul className="flex flex-col gap-2">
          {EXPERIMENTS.map((exp) => (
            <li key={exp.id} className="flex flex-col gap-1.5 rounded-sm border border-line px-2.5 py-2">
              <span className="text-sm text-ivory-100">{exp.title}</span>
              <p className="text-xs text-ivory-300">{exp.instructions}</p>
              <Button size="sm" variant="ghost" className="self-start" onClick={() => start(exp)}>
                Start
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const budgetText = active.editBudget === null ? 'no limit' : `${editCount} / ${active.editBudget} used`;
  const overBudget = active.editBudget !== null && editCount > active.editBudget;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="text-sm text-ivory-100">{active.title}</span>
        <p className="mt-1 text-xs text-ivory-300">{active.instructions}</p>
      </div>
      <Divider />
      <div className="flex items-center gap-4">
        <Readout label="edits" value={budgetText} accent={overBudget ? 'warn' : null} />
        <Readout label="target gen" value={active.targetGen} digits={5} />
      </div>
      {overBudget && (
        <p className="text-xs" style={{ color: 'var(--color-accent-warn)' }}>
          Over budget — restart to try again within the limit.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="ghost" onClick={restart}>Restart</Button>
        <Button size="sm" variant="solid" onClick={checkOutcome} disabled={checking}>
          {checking ? 'Checking…' : 'Check outcome'}
        </Button>
        <Button size="sm" variant="quiet" onClick={keepPlaying}>Keep playing, freely</Button>
        <Button size="sm" variant="quiet" onClick={exit}>Exit</Button>
      </div>

      {verdict && (
        <>
          <Divider />
          <VerdictView verdict={verdict} />
        </>
      )}
    </div>
  );
}
