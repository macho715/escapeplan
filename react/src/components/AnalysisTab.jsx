import React from "react";

import { Card } from "./ui.jsx";
import { MultiLineChart, Sparkline } from "./charts.jsx";
import TimelinePanel from "./TimelinePanel.jsx";

export default function AnalysisTab({
  history = [],
  derived,
  timeline = [],
  onClearHistory,
  onClearTimeline,
  onExportTimeline,
  historyMaxPoints = 96
}) {
  const histH0 = history.map((p) => p.scores?.H0 ?? 0);
  const histH1 = history.map((p) => p.scores?.H1 ?? 0);
  const histH2 = history.map((p) => p.scores?.H2 ?? 0);
  const histDs = history.map((p) => p.ds ?? 0);
  const histEc = history.map((p) => p.ec ?? 0);

  return (
    <div>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 900 }}>📈 Hypothesis Trend Graph</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>최근 {history.length} 포인트 (최대 {historyMaxPoints})</div>
          </div>
          <button onClick={onClearHistory} style={{ background: "#0b1220", border: "1px solid #1e293b", color: "#94a3b8", borderRadius: 10, padding: "10px 12px", fontSize: 11, fontWeight: 900, cursor: "pointer" }}>Reset history</button>
        </div>
        <div style={{ marginTop: 12 }}>
          <MultiLineChart height={160} min={0} max={1} series={[{ id: "H0", label: "H0", color: "#22c55e", data: histH0 }, { id: "H1", label: "H1", color: "#f59e0b", data: histH1 }, { id: "H2", label: "H2", color: "#ef4444", data: histH2 }]} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b", marginBottom: 6 }}><span>ΔScore trend</span><span style={{ fontFamily: "monospace" }}>{derived.ds.toFixed(3)}</span></div>
            <Sparkline data={histDs} min={-0.2} max={0.6} color="#f59e0b" />
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b", marginBottom: 6 }}><span>EvidenceConf trend</span><span style={{ fontFamily: "monospace" }}>{derived.ec.toFixed(3)}</span></div>
            <Sparkline data={histEc} min={0} max={1} color="#22c55e" />
          </div>
        </div>
      </Card>
      <Card style={{ marginBottom: 0 }}>
        <TimelinePanel timeline={timeline} onClear={onClearTimeline} onExport={onExportTimeline} />
      </Card>
    </div>
  );
}
