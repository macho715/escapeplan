import React from "react";

export function Sparkline({ data = [], min = 0, max = 1, color = "#60a5fa", height = 44 }) {
  const width = 220;
  const n = Array.isArray(data) ? data.length : 0;

  if (n < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }}>
        <rect x="0" y="0" width={width} height={height} rx="10" fill="#0b1220" stroke="#1e293b" />
        <text x={width / 2} y={height / 2 + 4} textAnchor="middle" fill="#475569" fontSize="11">no data</text>
      </svg>
    );
  }

  const clamp = (v) => Math.min(max, Math.max(min, v));
  const span = (max - min) || 1;
  const xs = Array.from({ length: n }, (_, i) => (i / (n - 1)) * width);
  const ys = xs.map((_, i) => {
    const v = Number(data[i] ?? 0);
    const vv = Number.isFinite(v) ? clamp(v) : 0;
    return height - ((vv - min) / span) * height;
  });
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${ys[i].toFixed(2)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }}>
      <rect x="0" y="0" width={width} height={height} rx="10" fill="#0b1220" stroke="#1e293b" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" opacity="0.95" />
    </svg>
  );
}

export function MultiLineChart({ series = [], min = 0, max = 1, height = 160 }) {
  const width = 560;
  const n = Math.max(0, ...(series.map((s) => (Array.isArray(s.data) ? s.data.length : 0))));

  if (n < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }}>
        <rect x="0" y="0" width={width} height={height} rx="12" fill="#0b1220" stroke="#1e293b" />
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="#475569" fontSize="11">no history yet</text>
      </svg>
    );
  }

  const clamp = (v) => Math.min(max, Math.max(min, v));
  const span = (max - min) || 1;
  const xs = Array.from({ length: n }, (_, i) => (i / (n - 1)) * width);
  const gridY = [0.25, 0.5, 0.75].map((p) => height - p * height);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }}>
      <rect x="0" y="0" width={width} height={height} rx="12" fill="#0b1220" stroke="#1e293b" />
      {gridY.map((y, i) => (
        <line key={i} x1="0" x2={width} y1={y} y2={y} stroke="#111827" strokeWidth="1" />
      ))}
      {series.map((s, si) => {
        const data = Array.isArray(s.data) ? s.data : [];
        const ys = xs.map((_, i) => {
          const v = Number(data[i] ?? 0);
          const vv = Number.isFinite(v) ? clamp(v) : 0;
          return height - ((vv - min) / span) * height;
        });
        const path = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${ys[i].toFixed(2)}`).join(" ");
        const lastX = xs[xs.length - 1];
        const lastY = ys[ys.length - 1];
        return (
          <g key={si}>
            <path d={path} fill="none" stroke={s.color || "#60a5fa"} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" opacity="0.95" />
            <circle cx={lastX} cy={lastY} r="3.6" fill={s.color || "#60a5fa"} />
          </g>
        );
      })}
    </svg>
  );
}
