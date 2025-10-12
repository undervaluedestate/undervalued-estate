import React from 'react';

export default function Logo({ size = 36, ...props }: React.SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Undervalued Estate monogram"
      fill="currentColor"
      width={size}
      height={size}
      {...props}
    >
      {/* Roof */}
      <path d="M40 104L128 28L216 104H192L128 52L64 104H40Z" />
      {/* Right pillar */}
      <rect x="172" y="104" width="28" height="112" rx="4" />
      {/* Left pillar as downward arrow */}
      <path d="M56 104H84V156H100L70 208L40 156H56V104Z" />
      {/* Centered window: 2x2 panes */}
      <rect x="112" y="116" width="12" height="12" rx="2" />
      <rect x="132" y="116" width="12" height="12" rx="2" />
      <rect x="112" y="136" width="12" height="12" rx="2" />
      <rect x="132" y="136" width="12" height="12" rx="2" />
    </svg>
  );
}
