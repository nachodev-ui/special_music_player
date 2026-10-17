import { useId } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { DayPhase, RoomWeather } from '../../features/room/useRoomEnvironment';
const skies: Record<DayPhase, [string, string]> = { dawn: ['#e7b8c2', '#fbe9ce'], day: ['#c6dfe7', '#e8f2e9'], sunset: ['#c5afcd', '#f4c6ab'], night: ['#626c92', '#a6a7c2'] };
export function RoomWindow({ phase, weather }: { phase: DayPhase; weather: RoomWeather | null }) {
  const id = useId();
  const reduced = useReducedMotion();
  const rain = weather && ((weather.code >= 51 && weather.code <= 67) || weather.code >= 80);
  const snow = weather && ((weather.code >= 71 && weather.code <= 77) || weather.code === 85 || weather.code === 86);
  return <svg viewBox="0 0 260 265" width="100%" height="100%" aria-hidden="true">
    <defs>{Object.entries(skies).map(([key, colors]) => <linearGradient key={key} id={id + key} x2="0" y2="1"><stop stopColor={colors[0]} /><stop offset="1" stopColor={colors[1]} /></linearGradient>)}<clipPath id={id + 'clip'}><rect x="20" y="16" width="220" height="208" rx="47" /></clipPath></defs>
    <rect x="10" y="6" width="240" height="230" rx="57" fill="var(--room-wood)" stroke="var(--room-outline)" strokeWidth="3" />
    <g clipPath={'url(#' + id + 'clip)'}>
      <AnimatePresence initial={false}><motion.g key={phase} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 1.8 }}>
        <rect x="20" y="16" width="220" height="210" fill={'url(#' + id + phase + ')'} />
        {phase === 'night' ? <><path d="M192 47A22 22 0 1 0 211 81A25 25 0 0 1 192 47" fill="#fff5d6" /><path d="M62 45V53M58 49H66M106 75V83M102 79H110M207 115V123M203 119H211" stroke="#fff5d6" strokeWidth="2" /></> : <circle cx="182" cy={phase === 'day' ? 65 : 149} r="24" fill="#fff0c0" />}
      </motion.g></AnimatePresence>
      {weather && weather.cloudCover > 20 && <g fill="var(--surface)" opacity={weather.cloudCover > 70 ? .8 : .5}><path d="M24 95Q15 78 34 76Q36 51 61 64Q82 53 91 78Q115 80 110 95Z" /><path d="M145 123Q137 108 152 104Q160 88 178 98Q196 89 204 109Q225 110 221 123Z" /></g>}
      <path d="M20 204Q65 171 112 194T240 176V224H20Z" fill="#9dad99" opacity=".55" />
      {rain && !snow && <g stroke="#e9f0fb" strokeWidth="3" strokeLinecap="round">{[0,1,2,3,4,5,6].map(i => <path key={i} d={'M' + (37+i*29) + ' 144l-5 12 M' + (45+i*29) + ' 180l-5 12'} />)}</g>}
      {snow && <g fill="#fffefb">{[0,1,2,3,4,5,6].map(i => <circle key={i} cx={35+i*30} cy={i%2 ? 163 : 137} r="3" />)}</g>}
    </g>
    <path d="M130 17V225M21 126H239" stroke="var(--room-wood)" strokeWidth="8" />
    <path d="M4 235H256" stroke="var(--room-outline)" strokeWidth="8" strokeLinecap="round" />
    <path d="M4 25Q30 18 42 36L30 192Q12 196 3 183ZM256 25Q230 18 218 36L230 192Q248 196 257 183Z" fill="var(--soft)" stroke="var(--room-outline)" strokeWidth="2" />
  </svg>;
}
