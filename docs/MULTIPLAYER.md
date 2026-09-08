# Multiplayer — the honest design document

AFTERLIFE is, by default, a single-player, offline, account-free observatory.
Nothing in this document changes that default. What follows is the design of
an **opt-in** layer that lets several people watch and edit the *same* universe
together, built on a simple observation: AFTERLIFE already persists a world as
a **seed plus a sparse, generation-stamped `EditOp` log**
(`src/core/history.ts`), and edits already **commit atomically at a generation
boundary** (ARCHITECTURE.md § "Edits commit atomically"). A ~3000-generation
session is 47 KB precisely because the app never stores per-generation
snapshots — it stores *what changed, and when*. That is exactly the shape
lockstep netcode wants: instead of ever transmitting world state, every peer
sends the same tiny edits everyone already knows how to replay, and every
peer arrives at the same world by doing the same deterministic computation.

If you never open the multiplayer panel, none of this exists for you: no
network request, no connection attempt, no account prompt. See "The zero-cost
default" below for how that's enforced, not just promised.

## 1. The lockstep model

A **room** is four pieces of shared, agreed-upon state (`RoomSpec` in
`src/net/protocol.ts`):

- the **world spec** — width, height, boundary (`'torus'`, the app's only
  supported topology), **and the B/S rule** (e.g. `"B3/S23"`). The `rule` is
  part of world identity exactly like size — the concurrent work making the
  rule configurable (`src/core/rule.ts`, `LifeEngine.rule`) means two peers
  running different rules would silently compute different futures from the
  same edits, so a room refuses to connect a peer whose rule doesn't match
  (`describeWorldMismatch`) instead of quietly diverging.
- an RNG **seed** (reserved — AFTERLIFE's own curated scenes start from an
  explicit gen-0 `EditOp`, not `engine.seed()`, so this is forward-looking
  infrastructure for a future seeded-random start, not load-bearing today).
- a **start generation**.
- an ordered **edit log**.

No peer is a server. Every peer runs the identical `LifeEngine`/`step()`
already in `src/core/engine.ts`, fed the identical sequence of edits at the
identical generations, and therefore computes the identical result — this is
the same determinism guarantee that already makes `TimelineStore.goto()`
bit-exact replay possible, just distributed across machines instead of across
time on one.

**The rule that makes it work: never send state, only edits — and only
edits, stamped to a generation in the future.**

## 2. The latency buffer

An edit is stamped, at submit time, to land `LATENCY_BUFFER_GENS` generations
after the sender's own current generation (`stampEdit` in `protocol.ts`;
default **12**, ≈1 second at the app's default 12 generations/second). This
applies to **every** edit, including the sender's own — a multiplayer edit
never applies "now" for anyone, not even the person who drew it.

This symmetry is the entire mechanism, not an inefficiency to optimize away
later: if the author saw their own edit take effect instantly while every
other peer saw it take effect a second later, the author's own replayable
history would disagree with everyone else's from the very next generation —
a guaranteed desync, every single time anyone draws anything. Delaying
*everyone* by the same buffer, uniformly, is what keeps every peer's
`TimelineStore` entries identical.

The honest cost: **input lag**. You draw, and it appears roughly a second
later, for you too. This is the classic trade-off of lockstep netcode before
rollback techniques existed — and it's the right trade-off here, because nothing
about AFTERLIFE is twitch-timed. See "Limits" below.

## 3. Deterministic ordering

Two edits landing on the same generation are ordered by
**`(targetGen, peerId, seq)`** — `compareStampedEdits` in `protocol.ts`. Every
peer computes this ordering independently from the same wire data (nobody
needs to ask a server "who goes first"), so if two edits touch the same cell
in the same generation, every peer applies them in the same order and gets
the same last-write-wins outcome. This is proven directly in
`tests/net-lockstep.test.ts`: the same set of edits, delivered to two
independent engines in *different* arrival orders, produce bit-identical
worlds.

## 4. Stall policy

The simulation must never advance past a generation whose inputs aren't
fully known yet. `StallTracker` (`protocol.ts`) tracks every known peer's own
generation ("watermark"). Because a peer's edits are always stamped to
`theirGen + buffer`, and `theirGen` only ever increases, once every peer's
watermark has reached `g`, nobody can still submit an edit landing before
`g + buffer`. That makes `g + buffer - 1` **safe** — no known peer can still
contest it — and `StallTracker.safeGen()` is the minimum of that bound across
every peer: wait for the slowest one.

`LockstepRoom.canAdvanceTo(nextGen)` is that check. `src/ui/session.ts`'s
`step()` consults it once per generation (via the `setMultiplayerGate` hook —
see "Integration" below) and, if it returns `false`, **does nothing**: no
`engine.step()`, no `history.advance()`, no `gen:changed`. The render loop
keeps running (panning/selection stay live), but the world itself freezes at
its last safe generation. The moment the slow peer's watermark catches up,
the very next tick resumes automatically — there is no separate "paused for
network" state to manually clear.

This is surfaced honestly, not silently: `src/ui/multiplayer/MultiplayerPanel`
shows a **"Waiting for N peer(s) to catch up"** banner (with a
`role="status"` live region) the instant the room reports itself blocked,
naming exactly what's holding things up — never a frozen UI with no
explanation. A peer that drops off entirely (tab closed, network gone) stalls
the room the same way a slow one does, until it either catches up or
explicitly leaves (`'leave'` message) or its watermark simply stops
mattering because everyone else moves past what it could still contest.

## 5. Desync detection and recovery

Every `HASH_INTERVAL_GENS` generations (default **64** — the same cadence
`history.ts` already keyframes at, so the check always lands somewhere cheap
to re-derive), every peer computes a cheap FNV-1a hash of its own world
(`hashBits`) and broadcasts it. `DesyncMonitor` compares an incoming hash
against the local hash recorded for that same generation:

- **match** — nothing surfaced; this is the expected, silent common case.
- **mismatch** — a `RoomEvent` of type `'desync'` fires immediately.
  `MultiplayerPanel` shows a `role="alert"` banner naming the generation and
  the offending peer, with a **"Resync now"** button. This can never be
  missed the way a silently-diverging simulation could be — that is the
  entire point of hashing at all.
- **unknown** — we haven't recorded (or have pruned) our own hash for that
  generation; not evidence either way, and never reported as a mismatch.

**Recovery ("offer resync")**: pressing "Resync now" calls
`LockstepRoom.requestResync()`, which broadcasts a request for every peer's
authoritative edit log since a given generation. Any peer that has it
responds with its own `EditLog.since()` — every `StampedEdit` it has ever
accepted, deterministically ordered. `src/net/sessionBridge.ts` takes the
response and does a **full** `TimelineStore.reset()` + `loadEntries()` —
the same mechanism `applyExperimentDoc` already uses to restore a persisted
save — rebuilding local state entirely from someone else's authoritative
history rather than attempting a partial patch. This is provably exact
instead of "hopefully closer now".

**Honest limitation**: there is no elected authority. "Resync" asks *everyone*
and takes whichever authoritative response arrives; in a room with more than
two peers where multiple peers have themselves diverged from each other,
resync converges you to *someone's* history, not necessarily a majority
vote. For the collaborative-building use case this is built for (see
"Limits"), a real divergence should be rare — hashing catches it within one
`HASH_INTERVAL_GENS` window (≤64 generations, ≈5 seconds) of it happening —
and resync exists as a loud, explicit, user-triggered recovery, not a
silent auto-heal.

## 6. Joining a room already in progress

Two independently-running AFTERLIFE tabs are **not** guaranteed to be at the
same generation — each boots the same curated opening scene, but may have
been running on its own for any length of time before someone opens the
multiplayer panel. So:

- **Host** resets the local world to a clean, known generation 0
  (`loadScene(OPENING_SCENE)`) before announcing the room — an unambiguous
  starting point for anyone who joins.
- **Join** immediately calls `requestResync(-1)` (everything, from the
  start) and rebuilds local history from whatever the room already agrees
  on, via the same reset+replay path described above, **before**
  participating normally.

This is why joining takes a brief, visible "connecting" moment rather than
being instantaneous — that moment is a real, necessary replay, not a network
delay for its own sake.

## 7. The zero-cost default

Nothing above runs unless a user explicitly opens the multiplayer panel and
presses "Host" or "Join":

- `src/ui/App.tsx` and `src/ui/hud/Hud.tsx`/`HudMoreSheet.tsx` do not
  **statically** import anything from `src/net/**` or `src/ui/multiplayer/**`
  — enforced by a real import-statement parser in `tests/net-guard.test.tsx`,
  not just a promise. `<MultiplayerRoot/>` is reachable today from the HUD's
  "More tools" menu (and, at narrow widths, the mobile sheet) via the one
  sanctioned seam: `src/ui/hud/multiplayerLazy.tsx`'s `requestMultiplayer()`,
  which does a real dynamic `import('@/ui/multiplayer')` only when that entry
  is actually clicked.
- Merely importing `src/net/**` or `src/ui/multiplayer/**` (however it's
  reached) constructs zero `Transport`s and makes zero network calls — also
  asserted directly in `tests/net-guard.test.tsx`, including a behavioural
  check that mounting `MultiplayerLazyHost` (exactly as `App.tsx` does,
  unconditionally) renders nothing and touches neither module until
  `requestMultiplayer()` is actually called. A `BroadcastChannel`/`WebSocket`
  is only ever constructed inside `useMultiplayerStore`'s `hostRoom()`/
  `joinRoom()` actions, which only run when a user clicks the corresponding
  button.
- `src/ui/session.ts` gained exactly three optional hooks
  (`setMultiplayerGate`/`setMultiplayerEditSource`/
  `setMultiplayerEditInterceptor`), each defaulting to `null`. Every call
  site is a single reference check (`multiplayerGate && !multiplayerGate(...)`,
  etc.) with no allocation — solo play pays no measurable cost, and no code
  under `src/net/**` is ever imported or executed by `session.ts` unless
  something *outside* it (only `src/net/sessionBridge.ts`, only after
  joining a room) calls these setters.

## 8. What genuinely works today, with no account and no server

Open the app in two tabs (or two browser profiles, same origin). Pick
"This browser" as the connection method, host a room in one tab, join with
the room code in the other. This uses `BroadcastChannelTransport`
(`src/net/transport.ts`), a thin wrapper over the standard `BroadcastChannel`
Web API — same-origin, cross-tab messaging that the browser provides for
free. It is not a mock or a stand-in for "real" multiplayer; it **is** local
multiplayer, and it is what `e2e/multiplayer.spec.ts` drives directly (two
real Playwright tabs, a real `BroadcastChannel`, the actual shipped
`src/net/**` modules and `src/core/engine.ts` — no test doubles) to prove the
lockstep engine converges bit-identically end to end.

## 9. Limits — read this before relying on it for anything twitchy

- **~1 second of input lag**, unconditionally, for every edit from every
  peer, including your own. This suits **collaborative building** —
  sketching a pattern together, watching a shared universe evolve, taking
  turns nudging it — not fast back-and-forth interaction.
- **A slow or dropped peer stalls the whole room.** There is no
  "kick and continue" — leaving is the peer's own explicit action
  (`LockstepRoom.leave()`), or the host/other peers simply wait. This is a
  deliberate consequence of "no server, no authority": nobody peer gets to
  unilaterally decide another peer's inputs no longer matter.
- **No mid-session rule or world-size changes.** A room's `RoomWorldSpec` is
  fixed at creation; changing the rule (`LifeEngine.setRule()`) mid-history
  is already a fresh-world operation for a single player (see
  `src/core/engine.ts`'s doc) and is simply not attempted here.
- **Editing the past is local-only.** Scrubbing back and drawing (the
  existing single-player "alternate futures" branching feature) has no
  shared representation across peers — a room has no way to give every peer
  their own private past at once — so `src/net/sessionBridge.ts`'s
  interceptor only claims edits made at the branch's current `maxGen`;
  anything else falls through to ordinary, unsynced local branching.
- **Resync has no elected authority** — see § 5's honest limitation.

## 10. The optional accounts/hosting path

AFTERLIFE's frontend is fully static (`vite build`) and can be hosted
anywhere, including **Vercel**. Nothing about adding accounts or a hosted
relay requires leaving that behind. But be specific about the one piece that
doesn't fit Vercel's model:

**Vercel's serverless functions are a poor fit for persistent WebSocket
rooms.** A serverless function is invoked per-request and has no guaranteed
long-lived process to hold an open socket across multiple peers' connections
— exactly what a multiplayer room needs. Vercel is an excellent choice for
serving the static app and for auth/API routes; it is the wrong tool for the
stateful, always-connected relay itself.

**Recommended split:**

- **Vercel (or GitHub Pages, as today)** — serves the static app and, if
  accounts exist, handles auth and any REST-y API routes (room listing,
  ownership, save persistence).
- **A small relay on infrastructure built for stateful connections** —
  [PartyKit](https://www.partykit.io/) or [Cloudflare Durable
  Objects](https://developers.cloudflare.com/durable-objects/) (one Durable
  Object instance per room, naturally matching "one authoritative ordering
  point per room code") or [Supabase Realtime](https://supabase.com/docs/guides/realtime)
  (if already using Supabase for accounts, its Realtime channels do the same
  job). Any of these hold a genuinely persistent connection per room.

**What the relay must do — and must NOT do:**

- Accept a `WebSocket` connection per peer, scoped to a room code.
- **Order and rebroadcast `WireMessage`s** (`src/net/protocol.ts`) to every
  other connected peer in that room. That's it.
- It **never simulates**. It never runs `LifeEngine.step()`, never inspects
  cell state, never decides what's "correct" — the whole point of the
  lockstep design is that every peer already computes the same answer from
  the same inputs, so the relay's job is purely **transport**: move bytes,
  don't interpret them. `src/net/transport.ts`'s `WebSocketTransport` is
  already written to this exact contract (JSON-framed `WireMessage`s, one
  connection per room) — a compliant relay literally just needs to
  broadcast whatever it receives from one connection to every other
  connection sharing that room's URL/path.
- This keeps the **local-first, no-account default completely intact**: the
  relay is additive infrastructure for people who explicitly want to play
  across the open internet, not a requirement to use the app, and not a
  requirement even to use multiplayer (`BroadcastChannelTransport` still
  covers same-browser play with zero infrastructure at all).

**What would need building for real accounts + persistent hosted rooms**
(none of this exists today — this is the honest "here's the shape of it"):

- **Identity**: some auth provider (Supabase Auth, Clerk, or Vercel's own
  integrations) issuing a stable user id, so a `PeerId` can be tied to a
  real account instead of a random per-tab UUID (`randomPeerId()` in
  `src/ui/multiplayer/store.ts` today).
- **Room persistence**: today a room is purely in-memory/in-transit — closing
  every tab loses the room (though not the world; the world's own save
  format is unaffected). Persistent rooms need a database row per room
  (owner, world spec, room code, `EditLog` history) and the relay writing to
  it, not just rebroadcasting.
- **Ownership**: who can rename/close a room, invite others, or see it in a
  "my rooms" list — an authorization layer on top of the identity above.

**Mapping the existing 47 KB save format onto a KV/Postgres row**: the
existing `ExperimentDoc` (`src/persist/codec.ts`) is already exactly the
right shape for this — it's a seed/world spec plus a branch tree of sparse
edits, the same "small because it's edits, not frames" property that makes
multiplayer feasible in the first place. A hosted room row is almost
literally:

| Column | From |
| --- | --- |
| `room_code` (primary key) | `RoomSpec.code` |
| `world_spec` (jsonb) | `RoomSpec.world` (width/height/boundary/rule) |
| `owner_id` | the authenticated user id (new) |
| `edit_log` (jsonb, or a KV list) | `EditLog.since(-1)` — every accepted `StampedEdit`, already peer/seq/gen-stamped |
| `created_at` / `updated_at` | already tracked (`RoomSpec.createdAt`, each edit's `originGen`) |

For a KV store (Cloudflare KV, Durable Object storage, Redis), the natural
shape is one key per room holding the serialized edit log plus world spec —
functionally identical to `ExperimentDoc.edits`, just keyed by room code
instead of a local save id. For Postgres/Supabase, the edit log is a natural
child table (`room_id`, `peer_id`, `seq`, `target_gen`, `op` jsonb) with a
unique constraint on `(room_id, peer_id, seq)` — exactly `EditLog`'s own
dedup key (`editKey`) — so replaying it back through `TimelineStore.reset()`
+ `loadEntries()` reconstructs the room exactly the way `applyExperimentDoc`
already reconstructs a local save today. No new persistence *model* needs
inventing — only a place to put the same shape the app already has.
