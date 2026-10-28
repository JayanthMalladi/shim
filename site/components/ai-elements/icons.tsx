import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/** Status icons from the mockup. Pass `label` to expose them as images. */
type StatusIconProps = IconProps & { label?: string };

function a11y(label?: string) {
  return label
    ? ({ role: "img", "aria-label": label } as const)
    : ({ "aria-hidden": true } as const);
}

export function CheckCircleIcon({ size = 16, label, ...props }: StatusIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="#8FD0FF" strokeWidth={1.5} {...a11y(label)} {...props}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5 8.2l2 2 4-4.4" />
    </svg>
  );
}

export function XCircleIcon({ size = 16, label, ...props }: StatusIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="#FFB224" strokeWidth={1.5} {...a11y(label)} {...props}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
    </svg>
  );
}

/** Quarter arc on a dim ring: "in progress". */
export function ProgressIcon({ size = 16, label, ...props }: StatusIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" {...a11y(label)} {...props}>
      <circle cx="8" cy="8" r="6.5" stroke="#2E3236" strokeWidth={1.5} />
      <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" stroke="#FFB224" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 12, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path d="M4 2l4 4-4 4" />
    </svg>
  );
}

export function CopyIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} {...props}>
      <rect x="5" y="5" width="9" height="9" rx="2" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </svg>
  );
}

export function CheckIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function BulbIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.3} {...props}>
      <path d="M7 1.5a3.5 3.5 0 0 0-2 6.4V10h4V7.9a3.5 3.5 0 0 0-2-6.4zM5.5 12.5h3" />
    </svg>
  );
}

export function PullRequestIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <circle cx="4.5" cy="4" r="2" />
      <circle cx="4.5" cy="14" r="2" />
      <circle cx="13.5" cy="14" r="2" />
      <path d="M4.5 6v6M13.5 12V7a2 2 0 0 0-2-2H8M10 3 8 5l2 2" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <path d="M2 7h10M8 3l4 4-4 4" />
    </svg>
  );
}

export function SpinnerIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" {...props}>
      <circle cx="8" cy="8" r="6.5" stroke="#2E3236" strokeWidth={1.5} />
      <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" stroke="#FFB224" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

export function MenuIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" {...props}>
      <path d="M3 5h12M3 9h12M3 13h12" />
    </svg>
  );
}

export function CloseIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" {...props}>
      <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
    </svg>
  );
}

export function LogoMark({ size = 22, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 22 22" fill="none" {...props}>
      <path d="M3 17 L19 5 L19 17 Z" stroke="#FFB224" strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}
