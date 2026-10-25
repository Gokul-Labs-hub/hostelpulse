export function Brand({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#17252b" />
      <circle cx="32" cy="32" r="19" fill="none" stroke="#f3b94d" strokeWidth="6" />
      <circle cx="32" cy="32" r="8" fill="#f3b94d" />
    </svg>
  );
}

// A hostel front with some windows lit. Decorative only: it shows no data.
export function Facade() {
  const lit = new Set([1, 4, 6, 9, 12, 14, 17, 20, 22]);
  const cells = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 8; c++) {
      const i = r * 8 + c;
      cells.push(<rect key={i} x={28 + c * 33} y={28 + r * 32} width="21" height="21" rx="3" className={lit.has(i) ? "win lit" : "win"} />);
    }
  return (
    <svg viewBox="0 0 320 136" className="facade" aria-hidden="true">
      <rect x="12" y="12" width="296" height="116" rx="10" className="wall" />
      {cells}
      <rect x="0" y="130" width="320" height="2" className="ground" />
    </svg>
  );
}

export function Ring({ pct }: { pct: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg width="132" height="132" viewBox="0 0 132 132" role="img" aria-label={`Attendance ${pct} percent`}>
      <circle cx="66" cy="66" r={r} className="ring-bg" />
      <circle cx="66" cy="66" r={r} className="ring-fg" strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 66 66)" />
      <text x="66" y="75" textAnchor="middle" className="ringnum">{pct}%</text>
    </svg>
  );
}

const paths: any = {
  camera: <><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  pin: <><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  wifi: <><path d="M3 9a14 14 0 0 1 18 0M6 12.5a9.5 9.5 0 0 1 12 0M9 16a5 5 0 0 1 6 0" /><circle cx="12" cy="19" r="1" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
};
export function Icon({ name }: { name: string }) {
  return <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
