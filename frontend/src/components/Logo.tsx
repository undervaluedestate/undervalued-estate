import React from 'react';

type Props = {
  size?: number;
  className?: string;
  alt?: string;
  style?: React.CSSProperties;
};

export default function Logo({ size = 36, className, alt = 'Undervalued Estate', style }: Props) {
  // Use exact asset from /public for pixel-perfect fidelity.
  // Fallback to PNG if SVG missing.
  return (
    <img
      src="/logo.png"
      onError={(e) => { const t = e.currentTarget as HTMLImageElement; if (!t.src.endsWith('/logo.svg')) t.src = '/logo.svg'; }}
      width={size}
      height={size}
      alt={alt}
      className={className}
      style={{ display:'inline-block', width: size, height: size, objectFit:'contain', ...style }}
    />
  );
}
