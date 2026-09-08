import type { PeerShape } from './colors';

export interface PeerGlyphProps {
  shape: PeerShape;
  color: string;
  size?: number;
  className?: string;
}

/** A small filled glyph identifying a peer — shape carries the same
 *  distinction as colour so nothing here depends on colour perception alone. */
export function PeerGlyph({ shape, color, size = 10, className = '' }: PeerGlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" className={className}>
      <title>{shape}</title>
      {shape === 'circle' ? <circle cx={5} cy={5} r={4.5} fill={color} /> : null}
      {shape === 'square' ? <rect x={0.5} y={0.5} width={9} height={9} rx={1.5} fill={color} /> : null}
      {shape === 'triangle' ? <path d="M5 0.5 L9.5 9.5 L0.5 9.5 Z" fill={color} /> : null}
      {shape === 'diamond' ? <path d="M5 0 L10 5 L5 10 L0 5 Z" fill={color} /> : null}
    </svg>
  );
}
