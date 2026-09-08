/**
 * Public entry point for `src/net/**`. Import from here (or from
 * `./sessionBridge` directly, since that one deliberately imports
 * `@/ui/session` and callers already know that) rather than reaching into
 * `./protocol`/`./transport`/`./room` unless you're already inside this
 * module. See `docs/MULTIPLAYER.md` for the design this implements.
 */
export {
  LATENCY_BUFFER_GENS,
  HASH_INTERVAL_GENS,
  EDIT_LOG_RETENTION_GENS,
  PEER_STALL_REPORT_MS,
  DesyncMonitor,
  EditLog,
  StallTracker,
  compareStampedEdits,
  describeWorldMismatch,
  editKey,
  generateRoomCode,
  hashBits,
  stampEdit,
} from './protocol';
export type {
  DesyncCheckResult,
  EditAcceptResult,
  NetEditOp,
  PeerId,
  PeerWatermark,
  RoomSpec,
  RoomWorldSpec,
  StampedEdit,
  WireMessage,
} from './protocol';

export {
  BroadcastChannelTransport,
  WebSocketTransport,
  broadcastChannelName,
} from './transport';
export type { Disposable, Transport, TransportStatus, WebSocketTransportOptions } from './transport';

export { LockstepRoom, createLockstepRoom } from './room';
export type { LockstepRoomOptions, PeerInfo, RoomEvent } from './room';

export { attachSessionToRoom } from './sessionBridge';
export type { SessionBridgeHandle } from './sessionBridge';
