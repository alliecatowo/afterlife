# AFTERLIFE

**A playable observatory for tiny universes. Every future leaves a trace.**

Conway's Game of Life as an instrument: scrub time backwards and forwards, extrude real
recorded history into a 3D Time Sculpture, and fork alternate futures to compare what
might have been.

```sh
mise install && npm install && npm run dev
```

Node 22, pinned by `mise.toml`. If `node` isn't on your PATH, prefix commands with
`mise exec --`.

| Script | Does |
| --- | --- |
| `npm run dev` | Vite dev server on :5173 |
| `npm run build` | Typecheck, then production build |
| `npm run preview` | Serve the production build |
| `npm test` | Vitest |
| `npm run typecheck` | `tsc --noEmit` |

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the module map, contracts and file
ownership, and [`DESIGN.md`](./DESIGN.md) for the design system.
