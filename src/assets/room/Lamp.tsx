import { motion, useReducedMotion } from 'motion/react';
export function Lamp({ lit }: { lit: boolean }) {
  const reduced = useReducedMotion();
  return <svg viewBox="0 0 143 239" width="100%" height="100%" aria-hidden="true">
    <motion.ellipse initial={false} cx="71" cy="104" rx="70" ry="87" fill="#ffe6a0" animate={{ opacity: lit ? .22 : 0 }} transition={{ duration: reduced ? 0 : .7 }} />
    <path d="M71 80V218" stroke="var(--room-outline)" strokeWidth="8" />
    <ellipse cx="71" cy="221" rx="43" ry="10" fill="var(--room-wood)" stroke="var(--room-outline)" strokeWidth="3" />
    <motion.path initial={false} d="M38 20H104L127 85Q71 103 15 85Z" stroke="var(--room-outline)" strokeWidth="3" animate={{ fill: lit ? '#ffe6a0' : '#e4cfbc' }} transition={{ duration: reduced ? 0 : .6 }} />
    <path d="M102 98V125" stroke="var(--room-outline)" strokeWidth="2" /><circle cx="102" cy="129" r="5" fill="var(--accent)" />
    <path d="M46 29L35 78M94 29L106 78" stroke="var(--surface)" strokeWidth="2" opacity=".6" />
  </svg>;
}
