/**
 * AFTERLIFE — inline stroke icon set. Hand-drawn, not a library.
 * 16px grid, 1.5px stroke, round joins/caps, `currentColor`. No emoji, ever.
 */
import type { SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps & { children: React.ReactNode }) {
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
      {children}
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 2.5v11l9-5.5z" strokeLinejoin="round" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 3v10M11.5 3v10" />
    </Svg>
  );
}

export function StepBackIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 3v10" />
      <path d="M13 4l-6.5 4L13 12z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function StepForwardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 3v10" />
      <path d="M3 4l6.5 4L3 12z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function GaugeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 11.5a5.5 5.5 0 0 1 11 0" />
      <path d="M8 8l3-2.5" />
      <path d="M8 11.5h.01" />
    </Svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.75" />
    </Svg>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M2 6.5h12M2 10.5h12M6.5 2v12M10.5 2v12" />
    </Svg>
  );
}

export function ChevronIcon({
  direction = 'right',
  ...props
}: IconProps & { direction?: 'up' | 'down' | 'left' | 'right' }) {
  const rotate = { up: 180, down: 0, left: 90, right: -90 }[direction];
  return (
    <Svg {...props} style={{ transform: `rotate(${rotate}deg)`, ...props.style }}>
      <path d="M4 6l4 4 4-4" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  );
}

export function DrawerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M6.5 2.5v11" />
    </Svg>
  );
}

export function PanelIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M9.5 2.5v11" />
    </Svg>
  );
}

export function BranchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="8" r="1.5" />
      <path d="M4.5 5v6" />
      <path d="M4.5 6.5c0 2 1.5 1.5 5.5 1.5" />
    </Svg>
  );
}

export function ColumnsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M8 2.5v11" />
    </Svg>
  );
}

export function SlidersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 3v10M8 3v10M13 3v10" />
      <circle cx="3" cy="6.5" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="8" cy="10" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="13" cy="5" r="1.25" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 3.2c1.6-.6 3.4-.6 5 0v9.6c-1.6-.6-3.4-.6-5 0z" />
      <path d="M13.5 3.2c-1.6-.6-3.4-.6-5 0v9.6c1.6-.6 3.4-.6 5 0z" />
    </Svg>
  );
}

export function ExpandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
    </Svg>
  );
}

export function CompressIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
    </Svg>
  );
}

export function SpeakerOnIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 6.5v3h2.3L8 12V4L4.8 6.5z" fill="currentColor" stroke="none" />
      <path d="M10.5 5.5a4 4 0 0 1 0 5" />
      <path d="M12.3 4a6.5 6.5 0 0 1 0 8" />
    </Svg>
  );
}

export function SpeakerOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 6.5v3h2.3L8 12V4L4.8 6.5z" fill="currentColor" stroke="none" />
      <path d="M10.5 6.5l3.5 3M14 6.5l-3.5 3" />
    </Svg>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.2 14.5 13.3H1.5Z" />
      <path d="M8 6.3v3.1M8 11.4h.01" />
    </Svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 5v3.2l2.2 1.3" />
    </Svg>
  );
}

export function GripIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="5.5" cy="4.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="4.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 8.5l3 3 6-7" />
    </Svg>
  );
}

export function DotIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function QuestionIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.8 6a2.2 2.2 0 1 1 3.4 1.85C8.4 8.4 8 8.8 8 9.6" />
      <path d="M8 12h.01" />
    </Svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.5 2.5 13.5 5.5 5 14 2 14 2 11Z" />
      <path d="M9 4l3 3" />
    </Svg>
  );
}

export function EraserIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.5 2.5 13.5 6.5 7 13H4L1.5 10.5Z" />
      <path d="M6 13h8" />
    </Svg>
  );
}

export function HandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 8V3.2a1 1 0 0 1 2 0V7" />
      <path d="M7 7V2.7a1 1 0 0 1 2 0V7" />
      <path d="M9 7V3.2a1 1 0 0 1 2 0V8" />
      <path d="M11 8V5.2a1 1 0 0 1 2 0V10c0 2.5-1.8 4.5-4.5 4.5S4 12.3 4 10.5V9L2.7 7.6a1 1 0 0 1 1.5-1.3L5 7.3" />
    </Svg>
  );
}

export function MarqueeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="0.5" strokeDasharray="2.2 2.2" />
    </Svg>
  );
}

export function StampIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.5 9.5v-3a2.5 2.5 0 0 1 5 0v3" />
      <path d="M3 9.5h10L12 13H4Z" />
      <path d="M2.5 13h11" />
    </Svg>
  );
}

export function FlaskIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 2h4" />
      <path d="M6.7 2v4.2L2.9 12A1.5 1.5 0 0 0 4.2 14.4h7.6A1.5 1.5 0 0 0 13.1 12L9.3 6.2V2" />
      <path d="M4.6 10.5h6.8" />
    </Svg>
  );
}

export function SaveIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 2.5h8l2.5 2.5v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
      <path d="M5 2.5v3.5h5V2.5" />
      <path d="M5.5 9.5h5v4h-5z" />
    </Svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.5v7.5" />
      <path d="M4.5 7 8 10.5 11.5 7" />
      <path d="M2.5 13.5h11" />
    </Svg>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 10.5V3" />
      <path d="M4.5 6 8 2.5 11.5 6" />
      <path d="M2.5 13.5h11" />
    </Svg>
  );
}

export function WaveformIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M1.5 8h2l1.2-4.5L7 12.5l1.6-8L10 8.8 11 6.5l1 1.5h2.5" />
    </Svg>
  );
}

export function CompassIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M10.2 5.8 8.7 8.7 5.8 10.2 7.3 7.3Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M2.3 8h11.4M8 2.3v11.4" />
      <path d="M4.1 4.1c1.5 1.3 6.3 1.3 7.8 0M4.1 11.9c1.5-1.3 6.3-1.3 7.8 0" />
    </Svg>
  );
}
