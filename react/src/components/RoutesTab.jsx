import React from "react";

import { Card } from "./ui.jsx";
import RouteMapLeaflet from "./RouteMapLeaflet.jsx";

export default function RoutesTab({
  dash,
  selectedRouteId,
  onSelectRoute,
  normalizeNewsRef,
  routeBufferFactor
}) {
  return (
    <div>
      <Card>
        <RouteMapLeaflet routes={dash.routes} routeGeo={dash.routeGeo} selectedId={selectedRouteId} onSelect={onSelectRoute} />
        {selectedRouteId && (
          <div style={{ marginTop: 12, background: "#0b1220", border: "1px solid #1e293b", borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 900 }}>Selected Route: {selectedRouteId}</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>아래 카드에서 해당 Route가 하이라이트됩니다.</div>
          </div>
        )}
      </Card>
      {(dash.routes || []).map((r) => {
        const eff = r.base_h * (1 + (r.cong ?? r.congestion ?? 0)) * routeBufferFactor;
        const isBlocked = r.status === "BLOCKED";
        const isCaution = r.status === "CAUTION";
        const borderColor = selectedRouteId === r.id ? "#3b82f6" : (isBlocked ? "#7f1d1d" : isCaution ? "#92400e" : "#1e293b");
        const badgeBg = isBlocked ? "#7f1d1d" : isCaution ? "#92400e" : "#14532d";
        const statusColor = isBlocked ? "#f87171" : isCaution ? "#f59e0b" : "#22c55e";
        const refs = (Array.isArray(r.newsRefs) ? r.newsRefs : []).map(normalizeNewsRef).filter(Boolean);

        return (
          <div key={r.id} style={{ background: "#0f172a", border: `2px solid ${borderColor}`, borderRadius: 12, padding: 16, marginBottom: 10, opacity: isBlocked ? 0.82 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: badgeBg, fontSize: 13, fontWeight: 900, color: "#fff" }}>{r.id}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 900 }}>{r.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, color: statusColor, fontWeight: 900 }}>{r.status}</span>
                    {isBlocked && <span style={{ fontSize: 9, background: "#7f1d1d", color: "#fca5a5", padding: "2px 6px", borderRadius: 6, fontWeight: 900 }}>⛔ 사용금지</span>}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", color: isBlocked ? "#f87171" : "#e2e8f0" }}>{isBlocked ? "—" : `${eff.toFixed(1)}h`}</div>
                <div style={{ fontSize: 10, color: "#64748b" }}>{isBlocked ? "차단" : `effective (buffer x${routeBufferFactor})`}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div style={{ background: "#1e293b", borderRadius: 10, padding: 10, textAlign: "center" }}><div style={{ fontSize: 10, color: "#64748b" }}>Base</div><div style={{ fontSize: 14, fontWeight: 900, fontFamily: "monospace", color: "#94a3b8" }}>{r.base_h}h</div></div>
              <div style={{ background: "#1e293b", borderRadius: 10, padding: 10, textAlign: "center" }}><div style={{ fontSize: 10, color: "#64748b" }}>Congestion</div><div style={{ fontSize: 14, fontWeight: 900, fontFamily: "monospace", color: (r.cong ?? r.congestion ?? 0) > 0.5 ? "#f87171" : (r.cong ?? r.congestion ?? 0) > 0.3 ? "#f59e0b" : "#22c55e" }}>{(r.cong ?? r.congestion ?? 0).toFixed(2)}</div></div>
              <div style={{ background: "#1e293b", borderRadius: 10, padding: 10, textAlign: "center" }}><div style={{ fontSize: 10, color: "#64748b" }}>Status</div><div style={{ fontSize: 14, fontWeight: 900, color: statusColor }}>{r.status}</div></div>
            </div>
            {r.note && <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 6 }}>{r.note}</div>}
            {refs.length > 0 && (
              <div style={{ marginTop: 10, background: "#0b1220", border: "1px solid #1e293b", borderRadius: 10, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 900 }}>Related refs</div>
                  <div style={{ fontSize: 10, color: "#475569" }}>{refs.length} items</div>
                </div>
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  {refs.map((ref) => (
                    ref.url
                      ? <a key={ref.id} href={ref.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#93c5fd", textDecoration: "none" }}>{ref.label}</a>
                      : <div key={ref.id} style={{ fontSize: 11, color: "#cbd5e1" }}>{ref.label}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
