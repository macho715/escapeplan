import { ROUTE_BUFFER_FACTOR } from "./constants.js";
import { formatDateTimeGST } from "./utils.js";

export function buildOfflineSummary(dash, derived) {
  const topIntel = (dash.intelFeed || []).slice(0, 3);
  const routes = Array.isArray(dash.routes) ? dash.routes : [];
  const usable = routes
    .filter((r) => r.status !== "BLOCKED")
    .map((r) => ({ ...r, eff: r.base_h * (1 + (r.cong ?? r.congestion ?? 0)) * ROUTE_BUFFER_FACTOR }))
    .sort((a, b) => a.eff - b.eff);

  const lines = [];
  lines.push(`요약(${formatDateTimeGST(new Date())} GST)`);
  lines.push(`- MODE: ${derived.modeState} / Gate: ${derived.gateState} / Airspace: ${derived.airspaceState}(${derived.airspaceSegment}) / Evidence: ${derived.evidenceState}`);
  lines.push(`- Leading: ${derived.leadingHypothesis.id} (${derived.leadingHypothesis.name}) score=${Number(derived.leadingHypothesis.score || 0).toFixed(3)} / H2=${derived.h2Score.toFixed(3)} → ${derived.likelihoodLabel} (${derived.likelihoodBand})`);
  lines.push(`- RED 지표: ΔScore=${derived.ds.toFixed(3)} (thr=0.20) / Conf=${derived.ec.toFixed(3)} vs Thr=${derived.effectiveThreshold.toFixed(3)} / Urgency=${derived.urgencyScore.toFixed(2)}`);
  lines.push(`- Evidence floor(TIER0 cv): ${derived.evidenceFloorT0} (target=3) → ${derived.evidenceFloorPassed ? "PASSED" : "NOT YET"}`);

  if (usable.length) {
    lines.push(`- 추천 이동(사용 가능): ${usable.slice(0, 2).map((r) => `Route ${r.id} ${r.status} ~${r.eff.toFixed(1)}h`).join(" · ")}`);
  } else {
    lines.push(`- 추천 이동: 사용 가능한 루트 없음(BLOCKED)`);
  }

  if (topIntel.length) {
    lines.push(`- 최신 Intel Top3:`);
    topIntel.forEach((it, idx) => {
      lines.push(`  ${idx + 1}) [${it.priority}] ${it.text}`);
    });
  }

  return lines.join("\n");
}
