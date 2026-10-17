import { motion, useReducedMotion } from 'motion/react';
import { softSpring } from '../../animations/presets';
export function Plant({ taps }: { taps: number }) {
  const reduced = useReducedMotion();
  return <svg viewBox="0 0 155 216" width="100%" height="100%" aria-hidden="true">
    <motion.g key={taps} style={{ transformOrigin: '78px 152px' }} animate={reduced ? {} : { rotate: taps ? [0, -5, 4, -2, 0] : [-1, 1, -1] }} transition={taps ? { duration: .6 } : { duration: 6, repeat: Infinity, ease: 'easeInOut' }} whileHover={reduced ? {} : { rotate: 4, y: -2 }}>
      <path d="M78 155V39M78 112L46 85M78 85L109 58" stroke="#8da080" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M78 74Q38 38 61 17Q92 23 78 74ZM76 110Q25 111 17 73Q57 58 76 110ZM78 88Q76 41 124 32Q146 66 78 88ZM79 139Q92 94 138 110Q137 148 79 139Z" fill="#afbf91" stroke="#8da080" strokeWidth="2" />
      <path d="M28 84L64 100M91 74L118 47M96 132L123 119" stroke="#dce6c5" strokeWidth="2" strokeLinecap="round" />
    </motion.g>
    <path d="M36 149H120L109 200Q78 212 47 200Z" fill="var(--soft)" stroke="var(--room-outline)" strokeWidth="3" />
    <rect x="31" y="143" width="94" height="17" rx="7" fill="var(--soft)" stroke="var(--room-outline)" strokeWidth="3" />
    <path d="M65 180Q69 186 73 180M84 180Q88 186 92 180M75 190Q79 194 83 190" fill="none" stroke="var(--room-outline)" strokeWidth="2" strokeLinecap="round" />
    <motion.path d="M130 21V35M123 28H137" stroke="var(--accent)" strokeWidth="2" animate={{ opacity: taps ? 1 : 0 }} transition={softSpring} />
  </svg>;
}
