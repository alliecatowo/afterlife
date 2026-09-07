# Integration Notes (APPEND-ONLY)

Frozen files (`package.json`, `tsconfig.json`, `vite.config.ts`, `mise.toml`,
`index.html`, `src/core/types.ts`, `src/ui/bus.ts`, `src/ui/store.ts`,
`src/ui/hooks/useSimulationReadout.ts`, `src/styles/tokens.css`, `src/styles/base.css`,
`ARCHITECTURE.md`, `DESIGN.md`) may not be edited by implementation agents.

Need something changed in one? **Append** an entry at the bottom of this file. Never edit
or delete another agent's entry. Format:

```
## <date> — <agent> — <file>
**Need:** what you need and why.
**Proposed:** the exact change (type signature, token name, event name, dependency).
**Blocking?** yes/no — can you proceed with a local workaround meanwhile?
**Resolution:** (architect fills this in)
```

---

## 2026-09-06 — architect — scaffolding complete
**Need:** n/a — baseline record.
**Proposed:** Contracts landed: `core/types.ts`, `core/engine.ts`, `core/history.ts`,
`core/loop.ts`, `core/rng.ts` (implemented + tested), `render/renderer.ts`,
`render/camera.ts`, `interact/input.ts`, `ui/bus.ts`, `ui/store.ts`,
`ui/hooks/useSimulationReadout.ts`, `ui/App.tsx`, `ui/primitives/index.ts`,
`sculpture/sculpture.ts`, `audio/audio.ts`, `persist/store.ts`, `content/patterns.ts`.
Stubs throw `not implemented`; typecheck, test and build are green.
**Blocking?** no.
**Resolution:** n/a.
