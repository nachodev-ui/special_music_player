import { motion, useReducedMotion } from 'motion/react';
export function Usagi({ taps }: { taps: number }) {
  const reduced = useReducedMotion();
  // Placeholder inspired by usagi_images/studying_usagi.jpg: glasses, cream fur, pink cheeks.
  return <svg viewBox="0 0 153 194" width="100%" height="100%" aria-hidden="true">
    <ellipse cx="76" cy="182" rx="52" ry="8" fill="var(--room-outline)" opacity=".12" />
    <motion.g style={{ transformOrigin: '76px 178px' }} animate={reduced ? {} : { y: taps ? [0, -7, 0] : [0, -2, 0] }} transition={taps ? { duration: .45 } : { duration: 5, repeat: Infinity, ease: 'easeInOut' }} key={taps}>
      <g stroke="var(--room-outline)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M49 83Q25 16 46 6Q61 2 64 78M81 77Q77 6 98 6Q118 13 100 86" fill="#fff1c7" />
        <path d="M48 63Q38 19 47 18Q54 18 54 64M89 65Q86 18 98 17Q107 19 97 69" fill="#edb6c0" stroke="none" />
        <ellipse cx="75" cy="154" rx="39" ry="31" fill="#fff1c7" />
        <ellipse cx="75" cy="107" rx="65" ry="53" fill="#fff1c7" />
        <path d="M41 173Q24 182 40 185L53 181M97 174Q117 184 102 186L88 181" fill="#fff1c7" />
        <ellipse cx="37" cy="126" rx="14" ry="9" fill="#efb8c2" stroke="none" /><ellipse cx="114" cy="126" rx="14" ry="9" fill="#efb8c2" stroke="none" />
        <path d="M22 94H67V120H22ZM84 94H129V120H84ZM67 103H84" fill="#fffefb" fillOpacity=".3" />
        <circle cx="47" cy="107" r="7" fill="var(--room-outline)" /><circle cx="105" cy="107" r="7" fill="var(--room-outline)" />
        <circle cx="49" cy="104" r="2" fill="#fffefb" stroke="none" /><circle cx="107" cy="104" r="2" fill="#fffefb" stroke="none" />
        <path d="M70 127Q75 133 80 127M75 132Q74 140 82 136M55 83Q44 77 37 83M97 83Q107 77 117 83" fill="none" />
        <path d="M27 153Q43 146 49 163M122 153Q106 146 101 164" fill="#fff1c7" />
      </g>
    </motion.g>
  </svg>;
}
