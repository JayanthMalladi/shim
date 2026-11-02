import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/** Stroke icons drawn in the Phosphor style (1.5px stroke, round caps). Decorative by default. */
function Svg({ size = 16, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Svg>
  );
}

/** The Shim mark: the orange wedge. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 2) / 3} viewBox="0 0 36 24" aria-hidden="true">
      <path d="M2 22 L34 4 L34 22 Z" fill="#FF6B3D" stroke="#111111" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}
