export function RoomShell() {
  return <g aria-hidden="true" strokeLinejoin="round">
    <path d="M0 0H1000V466H0Z" fill="var(--surface)" />
    <path d="M0 466H1000V640H0Z" fill="var(--tint)" />
    <path d="M0 454H1000V472H0Z" fill="var(--room-wood)" />
    <path d="M0 472H1000M140 472L70 640M355 472L330 640M645 472L670 640M860 472L930 640M0 560H1000" stroke="var(--room-outline)" opacity=".2" />
    <path d="M18 0V448M982 0V448" stroke="var(--line)" strokeWidth="2" />
    <ellipse cx="510" cy="571" rx="267" ry="47" fill="var(--soft)" stroke="var(--room-outline)" strokeOpacity=".18" strokeWidth="2" />
    <ellipse cx="510" cy="571" rx="242" ry="34" fill="none" stroke="var(--surface)" strokeWidth="2" strokeDasharray="6 8" />
    <path d="M405 96H552V217H405Z" fill="var(--room-wood)" stroke="var(--room-outline)" strokeWidth="2" />
    <path d="M414 105H543V208H414Z" fill="var(--bg)" />
    <path d="M435 168Q470 125 494 161T530 150V197H426Z" fill="var(--tint)" />
    <circle cx="501" cy="131" r="12" fill="var(--accent)" opacity=".6" />
    <text x="479" y="244" textAnchor="middle" fill="var(--muted)" fontSize="13" fontFamily="Zen Maru Gothic">おかえり。</text>
    <path d="M297 514H658V539H297Z" fill="var(--room-wood)" stroke="var(--room-outline)" strokeWidth="2" />
    <path d="M317 539V590M636 539V590" stroke="var(--room-outline)" strokeWidth="12" strokeLinecap="round" />
  </g>;
}
