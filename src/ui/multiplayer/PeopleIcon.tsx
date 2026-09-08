import type { SVGProps } from 'react';

/**
 * A local copy of the app's inline-stroke icon convention (16px grid, 1.5px
 * stroke, round joins/caps, `currentColor`) — see `@/ui/icons`'s module doc.
 * Kept inside `src/ui/multiplayer/**` rather than added to the shared
 * `@/ui/icons` barrel (owned by the `ui` agent) to avoid touching a file
 * outside this feature's boundary; see `INTEGRATION-NOTES.md` if this should
 * move there later.
 */
export function PeopleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <circle cx="5.5" cy="5" r="2" />
      <path d="M2 13c0-2.2 1.6-3.5 3.5-3.5S9 10.8 9 13" />
      <circle cx="11" cy="6" r="1.6" />
      <path d="M10 9.6c1.7.1 3 1.3 3 3.4" />
    </svg>
  );
}
