import { useState } from 'react';
import type { Track } from '../../shared/contracts';

type ArtworkSize = 'large' | 'medium' | 'small';

const palettes = [
  { pink: 'var(--hero-pink)', yellow: 'var(--hero-yellow)', label: 'var(--hero-yellow)' },
  { pink: 'var(--pop-pink-soft)', yellow: 'var(--hero-yellow)', label: 'var(--hero-pink)' },
  { pink: 'var(--pop-pink-base)', yellow: '#f8df91', label: 'var(--pop-pink-soft)' },
  { pink: 'var(--pop-pink-soft)', yellow: 'var(--hero-yellow)', label: 'var(--pop-pink-base)' },
] as const;

const pinkDots = [
  [8, 8, 3.2], [37, 9, 3], [68, 7, 3.3], [99, 10, 2.8],
  [21, 34, 3], [52, 37, 3.4], [84, 35, 3], [113, 37, 3.3],
  [7, 67, 3.3], [39, 65, 2.8], [70, 68, 3.1], [101, 67, 3.4],
  [22, 97, 3.4], [52, 99, 3], [84, 96, 3.3], [113, 100, 2.9],
];
const yellowDots = [
  [22, 13, 4], [84, 10, 3.5], [7, 45, 3.8], [68, 39, 4], [100, 42, 3.7],
  [23, 78, 3.8], [85, 74, 4], [112, 80, 3.6], [7, 111, 3.8], [69, 108, 4],
];

function paletteForTitle(title?: string) {
  if (!title) return palettes[0];
  let hash = 2166136261;
  for (const char of title) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
  return palettes[(hash >>> 0) % palettes.length];
}

export function PlaceholderArtwork({ title, size }: { title?: string; size: ArtworkSize }) {
  const palette = paletteForTitle(title);
  const large = size === 'large';
  const vinylOffset = large ? 'translate(2 -5) scale(.9)' : undefined;

  return <svg className="artwork-illustration" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="120" height="120" fill="var(--hero-cream)" />
    <g fill={palette.pink}>{pinkDots.map(([cx, cy, r], index) => <circle key={index} cx={cx} cy={cy} r={r} />)}</g>
    <g fill={palette.yellow}>{yellowDots.map(([cx, cy, r], index) => <circle key={index} cx={cx} cy={cy} r={r} />)}</g>
    <g transform={vinylOffset}>
      <path d="M60 18 C80 17 100 32 102 55 C105 78 89 100 65 102 C42 105 19 89 18 65 C16 43 33 21 60 18Z" fill="var(--hero-ink)" transform="translate(5 6)" />
      <path d="M60 18 C80 17 100 32 102 55 C105 78 89 100 65 102 C42 105 19 89 18 65 C16 43 33 21 60 18Z" fill="#755767" stroke="var(--hero-ink)" strokeWidth="3.8" strokeLinejoin="round" />
      <path d="M59 25 C78 24 94 39 95 58 C97 79 81 94 61 95 C42 96 26 81 25 62 C24 42 39 27 59 25Z" fill="none" stroke="#b990a4" strokeWidth="1.6" opacity=".9" />
      <path d="M61 31 C78 31 88 44 89 60 C90 77 77 88 61 89 C44 90 32 77 32 61 C31 44 44 32 61 31Z" fill="none" stroke="var(--hero-ink)" strokeWidth="2.4" />
      <path d="M62 37 C75 37 83 47 83 60 C84 73 74 82 61 83 C48 83 39 73 38 62 C37 48 48 38 62 37Z" fill="none" stroke="#bd98a8" strokeWidth="1.7" />
      <path d="M43 30 C48 27 53 26 57 26 M88 46 C91 52 92 56 92 61 M34 77 C38 83 43 87 49 89" fill="none" stroke="#ead0d6" strokeWidth="2" strokeLinecap="round" />
      <path d="M61 46 C70 45 76 51 76 60 C77 69 71 76 62 76 C53 77 46 70 46 61 C45 53 52 47 61 46Z" fill={palette.label} stroke="var(--hero-ink)" strokeWidth="3" />
      <path d="M61 67 C57 64 53 61 53 57 C53 54 57 52 61 56 C65 52 69 54 69 57 C69 61 65 64 61 67Z" fill="var(--hero-cream)" stroke="var(--hero-ink)" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="61" cy="61" r="1.8" fill="var(--hero-ink)" />
    </g>
    {large && <>
      <path d="M17 17 19 24 26 26 19 28 17 35 15 28 8 26 15 24Z" fill="var(--hero-yellow)" stroke="var(--hero-ink)" strokeWidth="1.7" strokeLinejoin="round" transform="rotate(-11 17 26)" />
      <path d="M102 12 104 17 109 19 104 21 102 26 100 21 95 19 100 17Z" fill="var(--hero-cream)" stroke="var(--hero-ink)" strokeWidth="1.6" strokeLinejoin="round" transform="rotate(13 102 19)" />
      <g transform="rotate(-8 84 104)">
        <path d="M66 92 104 89 107 113 69 115Z" fill="var(--hero-ink)" transform="translate(3 3)" />
        <path d="M66 92 104 89 107 113 69 115Z" fill={palette.yellow} stroke="var(--hero-ink)" strokeWidth="2" strokeLinejoin="round" />
        <text x="74" y="107" fill="var(--hero-ink)" fontFamily="'Zen Maru Gothic', sans-serif" fontSize="13" fontWeight="800" letterSpacing="1">音楽</text>
      </g>
    </>}
  </svg>;
}

export function Artwork({ track, className = '', size }: { track: Track | null; className?: string; size?: ArtworkSize }) {
  const [failed, setFailed] = useState<string>();
  const source = track?.artwork;
  const showImage = !!source && source !== failed;
  return <div className={`artwork ${showImage ? '' : 'artwork-placeholder'} ${className}`} role={showImage ? undefined : 'img'} aria-label={showImage ? undefined : track ? `Carátula ilustrada de ${track.title}` : 'Carátula ilustrada de respaldo'}>
    {showImage ? <img src={source} alt={`Carátula de ${track?.title}`} decoding="async" onError={() => setFailed(source)} /> : <PlaceholderArtwork title={track?.title} size={size ?? (className.includes('large-artwork') ? 'large' : 'small')} />}
  </div>;
}
