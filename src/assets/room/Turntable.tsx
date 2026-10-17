import type { ReactNode } from 'react';
import { motion, type MotionValue } from 'motion/react';
export function Turntable({ rotation, label, playing }: { rotation: MotionValue<number>; label: ReactNode; playing: boolean }) {
  return <svg viewBox="0 0 340 220" width="100%" height="100%" aria-hidden="true">
    <path d="M13 203V73Q13 58 30 58H310Q327 58 327 73V203Z" fill="var(--room-wood)" stroke="var(--room-outline)" strokeWidth="3" />
    <path d="M21 58V20Q21 10 31 10H309Q319 10 319 20V58" fill="var(--tint)" fillOpacity=".5" stroke="var(--room-outline)" strokeWidth="3" />
    <rect x="27" y="69" width="286" height="130" rx="12" fill="var(--surface)" />
    <motion.g style={{ rotate: rotation, transformOrigin: '126px 130px' }}>
      <circle cx="126" cy="130" r="61" fill="#655d69" />
      {[53,46,39].map(r => <circle key={r} cx="126" cy="130" r={r} fill="none" stroke="#a99bab" strokeWidth="1" opacity=".5" />)}
      <foreignObject x="102" y="106" width="48" height="48">{label}</foreignObject>
      <circle cx="126" cy="130" r="3" fill="var(--surface)" />
    </motion.g>
    <circle cx="258" cy="91" r="11" fill="var(--room-wood)" stroke="var(--room-outline)" strokeWidth="2" />
    <motion.path d="M258 91V139L227 163" fill="none" stroke="var(--room-outline)" strokeWidth="7" strokeLinecap="round" animate={{ rotate: playing ? 0 : -17 }} style={{ transformOrigin: '258px 91px' }} />
    <rect x="213" y="159" width="23" height="12" rx="4" transform="rotate(-35 224 165)" fill="var(--accent)" />
    <circle cx="285" cy="181" r="5" fill={playing ? 'var(--accent)' : 'var(--line)'} />
    <text x="170" y="212" textAnchor="middle" fontSize="9" fill="var(--room-outline)" fontFamily="Zen Maru Gothic">ちいさな音楽 ♡</text>
  </svg>;
}
