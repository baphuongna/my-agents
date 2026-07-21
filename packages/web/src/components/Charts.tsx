/**
 * Sparkline — minimal SVG line chart, no dependency.
 */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "var(--accent)",
  fill = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  const clean = data.filter(Number.isFinite);
  if (clean.length < 2) return null;
  data = clean;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);

  const points = data.map((v, i) => ({
    x: i * step,
    y: height - ((v - min) / range) * (height - 4) - 2,
  }));

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  const fillPath = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg width={width} height={height} className="overflow-visible">
      {fill && (
        <path d={fillPath} fill={color} opacity={0.12} />
      )}
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {/* End dot */}
      <circle
        cx={points[points.length - 1]!.x}
        cy={points[points.length - 1]!.y}
        r={2}
        fill={color}
      />
    </svg>
  );
}

/**
 * ProgressBar — animated gradient progress bar.
 */
export function ProgressBar({
  value,
  max = 100,
  color = "var(--accent)",
  height = 6,
}: {
  value: number;
  max?: number;
  color?: string;
  height?: number;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="w-full rounded-full overflow-hidden bg-fg/5" style={{ height }}>
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 70%, var(--purple)))`,
        }}
      />
    </div>
  );
}

/**
 * RadialGauge — circular progress indicator.
 */
export function RadialGauge({
  value,
  max = 100,
  size = 80,
  thickness = 6,
  color = "var(--accent)",
  label,
  sublabel,
}: {
  value: number;
  max?: number;
  size?: number;
  thickness?: number;
  color?: string;
  label?: string;
  sublabel?: string;
}) {
  const pct = Math.min(1, Math.max(0, value / max));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border, #30363d)"
          strokeWidth={thickness}
          opacity={0.3}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {label && <span className="text-sm font-bold text-fg font-mono">{label}</span>}
        {sublabel && <span className="text-[8px] text-fg-subtle uppercase tracking-wide">{sublabel}</span>}
      </div>
    </div>
  );
}
