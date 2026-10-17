import type { ReactNode } from 'react';
export function AlbumShelf({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 285 258" width="100%" height="100%">
    <g aria-hidden="true" fill="var(--room-wood)" stroke="var(--room-outline)" strokeWidth="2">
      <rect x="5" y="5" width="275" height="248" rx="10" />
      <rect x="15" y="15" width="255" height="230" rx="6" fill="var(--bg)" />
      <path d="M10 111H275V122H10ZM10 217H275V228H10Z" />
    </g>
    <foreignObject x="20" y="19" width="245" height="220">{children}</foreignObject>
  </svg>;
}
