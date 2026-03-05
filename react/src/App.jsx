import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Bar, Gauge, Pill } from "./components/ui.jsx";
import { MultiLineChart, Sparkline } from "./components/charts.jsx";
import RouteMapLeaflet from "./components/RouteMapLeaflet.jsx";
import TimelinePanel from "./components/TimelinePanel.jsx";
import Simulator from "./components/Simulator.jsx";

import { INITIAL_DASHBOARD } from "./data/fallbackDashboard.js";
import { KEY_ASSUMPTIONS, VERSION_HISTORY } from "./data/hyieLegacyContent.js";
import { deriveState } from "./lib/deriveState.js";
import { normalizeIncomingPayload } from "./lib/normalize.js";
import { mergeTimelineWithNoiseGate } from "./lib/noiseGate.js";
import { buildOfflineSummary } from "./lib/summary.js";
import { appendHistory, buildDiffEvents, mkEvent, computeDashboardKey } from "./lib/timelineRules.js";

import {
  FALLBACK_EGRESS_LOSS_ETA,
  FAST_COUNTDOWN_SECONDS,
  FAST_POLL_MS_DEFAULT,
  FULL_SYNC_INTERVAL_MS,
  HISTORY_MAX_POINTS,
  ROUTE_BUFFER_FACTOR,
  STORAGE_KEYS,
  TIMELINE_MAX,
  getDashboardCandidates,
  getFastStateCandidates
} from "./lib/constants.js";

import {
  clampEgress,
  downloadJson,
  formatDateTimeGST,
  formatTimeGST,
  safeGetLS,
  safeJsonParse,
  safeSetLS,
  tryCopyText
} from "./lib/utils.js";

const FAST_FAIL_THRESHOLD = 5;

function normalizeNewsRef(ref, idx) {
  if (typeof ref === "string") {
    const label = ref.trim();
    if (!label) return null;
    return { id: `ref-${idx}`, label, url: "" };
  }
  if (!ref || typeof ref !== "object") return null;

  const title = String(ref.title || ref.text || ref.name || ref.label || "").trim();
  const url = String(ref.url || ref.link || "").trim();
  const label = title || url || `ref-${idx + 1}`;
  return { id: `ref-${idx}`, label, url: /^https?:\/\//i.test(url) ? url : "" };
}

export default function App() {
  const [now, setNow] = useState(new Date());
  const [tab, setTab] = useState("overview");
  const [nextEta, setNextEta] = useState(FAST_COUNTDOWN_SECONDS);
  const [dash, setDash] = useState(INITIAL_DASHBOARD);
  const [egressLossETA, setEgressLossETA] = useState(INITIAL_DASHBOARD?.metadata?.egressLossETA ?? FALLBACK_EGRESS_LOSS_ETA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [history, setHistory] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [summary, setSummary] = useState({ text: "", ts: null, mode: "OFFLINE" });
  const [autoSummary, setAutoSummary] = useState(false);

  const mounted = useRef(true);
  const synced = useRef(false);
  const prevDashRef = useRef(null);
  const prevDerivedRef = useRef(null);
  const didStartTicker = useRef(false);
  const didStartFastSync = useRef(false);
  const didStartFullSync = useRef(false);
  const fastFailCountRef = useRef(0);
  const fastFailLoggedRef = useRef(false);

  const fastPollMs = useMemo(() => {
    const env = Number(import.meta?.env?.VITE_FAST_POLL_MS);
    if (Number.isFinite(env) && env >= 1000) return Math.floor(env);
    return FAST_POLL_MS_DEFAULT;
  }, []);
  const fastCountdownSeconds = useMemo(() => Math.max(1, Math.ceil(fastPollMs / 1000)), [fastPollMs]);
  const fullSyncMinutes = Math.max(1, Math.round(FULL_SYNC_INTERVAL_MS / 60000));
  const fastCandidates = useMemo(() => getFastStateCandidates(), []);

  const derived = useMemo(() => deriveState(dash, egressLossETA), [dash, egressLossETA]);

  useEffect(() => {
    const rawE = Number(safeGetLS(STORAGE_KEYS.egress, ""));
    if (Number.isFinite(rawE) && rawE >= 0) setEgressLossETA(rawE);
    const rawHist = safeGetLS(STORAGE_KEYS.history, "");
    const parsedHist = safeJsonParse(rawHist, []);
    if (Array.isArray(parsedHist)) setHistory(parsedHist);
    const rawTl = safeGetLS(STORAGE_KEYS.timeline, "");
    const parsedTl = safeJsonParse(rawTl, []);
    if (Array.isArray(parsedTl)) setTimeline(parsedTl);
    setAutoSummary(safeGetLS(STORAGE_KEYS.autoSummary, "0") === "1");
  }, []);

  useEffect(() => {
    safeSetLS(STORAGE_KEYS.egress, String(Number.isFinite(egressLossETA) ? egressLossETA : FALLBACK_EGRESS_LOSS_ETA));
  }, [egressLossETA]);

  useEffect(() => {
    safeSetLS(STORAGE_KEYS.history, JSON.stringify(history.slice(-HISTORY_MAX_POINTS)));
  }, [history]);

  useEffect(() => {
    safeSetLS(STORAGE_KEYS.timeline, JSON.stringify(timeline.slice(0, TIMELINE_MAX)));
  }, [timeline]);

  useEffect(() => {
    safeSetLS(STORAGE_KEYS.autoSummary, autoSummary ? "1" : "0");
  }, [autoSummary]);

  useEffect(() => {
    setNextEta(fastCountdownSeconds);
  }, [fastCountdownSeconds]);

  const logEvent = useCallback((ev) => {
    setTimeline((prev) => mergeTimelineWithNoiseGate(prev, [mkEvent(ev)], { maxItems: TIMELINE_MAX }));
  }, []);

  const fetchCandidates = useCallback(async (candidates = []) => {
    for (const candidate of candidates) {
      try {
        const sep = candidate.includes("?") ? "&" : "?";
        const r = await fetch(`${candidate}${sep}t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) continue;
        const payload = await r.json();
        const normalized = normalizeIncomingPayload(payload);
        if (!normalized) continue;
        if (normalized?.metadata) normalized.metadata.source = candidate;
        return normalized;
      } catch {
        /* try next */
      }
    }
    return null;
  }, []);

  const mergeChecklist = (payloadChecklist, prevChecklist) => {
    return (payloadChecklist || []).map((item) => {
      const prev = (prevChecklist || []).find((p) => p.id === item.id);
      return prev ? { ...item, done: prev.done } : item;
    });
  };

  const applyDashboard = useCallback((nextDash) => {
    const egressNext = clampEgress(nextDash?.metadata?.egressLossETA);
    const nextDerived = deriveState(nextDash, egressNext);

    setEgressLossETA(egressNext);
    setDash((prev) => ({ ...nextDash, checklist: mergeChecklist(nextDash.checklist, prev.checklist) }));
    synced.current = true;

    setHistory((prev) => appendHistory(prev, nextDash, nextDerived, HISTORY_MAX_POINTS));

    const prevDash = prevDashRef.current;
    const prevDer = prevDerivedRef.current;
    const diff = buildDiffEvents(prevDash, nextDash, prevDer, nextDerived);
    if (diff.length) {
      setTimeline((prev) => mergeTimelineWithNoiseGate(prev, diff, { maxItems: TIMELINE_MAX }));
    }

    prevDashRef.current = nextDash;
    prevDerivedRef.current = nextDerived;
  }, []);

  const fetchDashboard = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const normalized = await fetchCandidates(getDashboardCandidates());
      if (!normalized) throw new Error("Invalid payload");
      if (!mounted.current) return;

      applyDashboard(normalized);
      setError(null);
      setLastUpdated(new Date());
      setNextEta(fastCountdownSeconds);
    } catch (err) {
      if (!mounted.current) return;
      if (!synced.current) applyDashboard(INITIAL_DASHBOARD);
      setError("데이터를 불러오지 못했습니다. 기본 데이터를 표시합니다.");
      logEvent({ level: "WARN", category: "SYSTEM", title: "Fetch failed → fallback", detail: String(err?.message || err || "") });
    } finally {
      if (showLoading && mounted.current) setLoading(false);
    }
  }, [applyDashboard, fastCountdownSeconds, fetchCandidates, logEvent]);

  const fetchFastState = useCallback(async () => {
    try {
      const normalized = await fetchCandidates(fastCandidates);
      if (!normalized) throw new Error("Fast poll unavailable");
      if (!mounted.current) return;

      applyDashboard(normalized);
      setLastUpdated(new Date());
      setNextEta(fastCountdownSeconds);
      setError(null);

      if (fastFailLoggedRef.current) {
        logEvent({
          level: "INFO",
          category: "SYSTEM",
          title: "Fast poll recovered",
          detail: `Recovered after ${fastFailCountRef.current} consecutive failures`,
          noiseKey: "SYSTEM|FAST_POLL|RECOVERED"
        });
      }
      fastFailCountRef.current = 0;
      fastFailLoggedRef.current = false;
    } catch {
      fastFailCountRef.current += 1;
      if (fastFailCountRef.current >= FAST_FAIL_THRESHOLD && !fastFailLoggedRef.current) {
        fastFailLoggedRef.current = true;
        logEvent({
          level: "WARN",
          category: "SYSTEM",
          title: "Fast poll degraded",
          detail: `Fast state polling failed ${fastFailCountRef.current} times; full sync remains active`,
          noiseKey: "SYSTEM|FAST_POLL|FAIL"
        });
      }
    }
  }, [applyDashboard, fastCandidates, fastCountdownSeconds, fetchCandidates, logEvent]);

  useEffect(() => {
    if (didStartTicker.current) return;
    didStartTicker.current = true;
    const t = setInterval(() => {
      setNow(new Date());
      setNextEta((p) => (p <= 0 ? fastCountdownSeconds : p - 1));
    }, 1000);
    return () => {
      mounted.current = false;
      clearInterval(t);
    };
  }, [fastCountdownSeconds]);

  useEffect(() => {
    if (didStartFastSync.current) return;
    didStartFastSync.current = true;
    mounted.current = true;
    fetchFastState();
    const id = setInterval(() => fetchFastState(), fastPollMs);
    return () => clearInterval(id);
  }, [fastPollMs, fetchFastState]);

  useEffect(() => {
    if (didStartFullSync.current) return;
    didStartFullSync.current = true;
    mounted.current = true;
    fetchDashboard(true);
    const id = setInterval(() => fetchDashboard(false), FULL_SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchDashboard]);

  const lastSummaryKeyRef = useRef("");
  useEffect(() => {
    if (!autoSummary) return;
    const k = computeDashboardKey(dash);
    if (!k || k === lastSummaryKeyRef.current) return;
    lastSummaryKeyRef.current = k;
    const text = buildOfflineSummary(dash, derived);
    setSummary({ text, ts: new Date().toISOString(), mode: "OFFLINE" });
  }, [autoSummary, dash, derived]);

  const tabs = [
    { id: "overview", label: "Overview", icon: "📊" },
    { id: "analysis", label: "Trends & Log", icon: "📈" },
    { id: "intel", label: "Intel Feed", icon: "🔴" },
    { id: "indicators", label: "Indicators", icon: "📡" },
    { id: "routes", label: "Routes", icon: "🗺️" },
    { id: "sim", label: "Simulator", icon: "🧪" },
    { id: "checklist", label: "Checklist", icon: "✅" }
  ];

  const updateTs = lastUpdated
    ? lastUpdated.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dubai" })
    : "—";
  const gstDateTime = useMemo(() => formatDateTimeGST(now), [now]);
  const lagLabel = Number.isFinite(derived.liveLagSeconds) ? `${derived.liveLagSeconds}s` : "n/a";

  const histH0 = useMemo(() => history.map((p) => p.scores?.H0 ?? 0), [history]);
  const histH1 = useMemo(() => history.map((p) => p.scores?.H1 ?? 0), [history]);
  const histH2 = useMemo(() => history.map((p) => p.scores?.H2 ?? 0), [history]);
  const histDs = useMemo(() => history.map((p) => p.ds ?? 0), [history]);
  const histEc = useMemo(() => history.map((p) => p.ec ?? 0), [history]);

  const exportTimeline = () => {
    const name = `timeline_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    downloadJson(name, timeline);
    logEvent({ level: "INFO", category: "SYSTEM", title: "Timeline exported", detail: name });
  };

  const usableRoutes = useMemo(() => {
    const list = (dash.routes || [])
      .filter((r) => r.status !== "BLOCKED")
      .map((r) => ({ ...r, eff: r.base_h * (1 + (r.cong ?? r.congestion ?? 0)) * ROUTE_BUFFER_FACTOR }))
      .sort((a, b) => a.eff - b.eff);
    return list;
  }, [dash.routes]);

  const stat = (value, suffix = "") => (Number.isFinite(Number(value)) ? `${Number(value)}${suffix}` : "n/a");

  return (
    <div style={{ minHeight: "100vh", padding: 12, maxWidth: 980, margin: "0 auto" }}>
      <div style={{ background: "linear-gradient(135deg,#0f172a,#1e1b4b)", border: "1px solid #334155", borderRadius: 16, padding: "14px 18px", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>HYIE ERC² Dashboard</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
              GST: {gstDateTime} · last fetch: {updateTs} · next in: {Math.floor(nextEta / 60)}:{String(nextEta % 60).padStart(2, "0")} (fast)
            </div>
            <div style={{ fontSize: 10, marginTop: 3, color: derived.liveStale ? "#f59e0b" : "#64748b" }}>
              full sync every {fullSyncMinutes}m · live lag: {lagLabel} · {derived.liveStale ? "STALE" : "fresh"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Pill label="MODE" value={derived.modeState} color={derived.modeColor} />
            <Pill label="Gate" value={derived.gateState} color={derived.gateState === "BLOCKED" ? "#ef4444" : derived.gateState === "CAUTION" ? "#f59e0b" : "#22c55e"} />
            <Pill label="I02" value={`${derived.airspaceState}/${derived.airspaceSegment}`} color={derived.airspaceState === "OPEN" ? "#22c55e" : derived.airspaceState === "DISRUPTED" ? "#f59e0b" : "#ef4444"} />
            <button onClick={() => fetchDashboard(true)} style={{ background: "#0b1220", border: "1px solid #1e293b", color: "#e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 11, fontWeight: 900, cursor: "pointer" }}>🔄 Refresh</button>
          </div>
        </div>
        {error && <div style={{ marginTop: 10, background: "rgba(239,68,68,0.10)", border: "1px solid #7f1d1d", color: "#fca5a5", borderRadius: 12, padding: "10px 12px", fontSize: 11 }}>❗ {error}</div>}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{ background: active ? "#1e293b" : "#0b1220", border: `1px solid ${active ? "#60a5fa" : "#1e293b"}`, color: active ? "#e2e8f0" : "#94a3b8", borderRadius: 12, padding: "10px 12px", fontSize: 12, fontWeight: 900, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
            >
              <span>{t.icon}</span><span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {tab === "overview" && (
        <div>
          <Card>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <Gauge value={Math.min(1, Math.max(0, derived.ec))} label="EvidenceConf" sub={`thr=${derived.effectiveThreshold.toFixed(2)}`} />
              <Gauge value={Math.min(1, Math.max(0, (derived.ds + 0.2) / 0.8))} label="ΔScore" sub={`raw=${derived.ds.toFixed(3)}`} />
              <Gauge value={derived.urgencyScore} label="Urgency" sub={`egress=${Number(egressLossETA).toFixed(2)}h`} />
            </div>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ background: "#0b1220", border: "1px solid #1e293b", borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900 }}>Likelihood</div>
                <div style={{ marginTop: 8, fontSize: 24, fontWeight: 900, color: derived.likelihoodLabel === "HIGHLY LIKELY" ? "#ef4444" : derived.likelihoodLabel === "LIKELY" ? "#f59e0b" : "#22c55e" }}>{derived.likelihoodLabel}</div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>{derived.likelihoodBand}</div>
                <div style={{ marginTop: 8, fontSize: 10, color: "#64748b" }}>{derived.likelihoodBasis}</div>
              </div>
              <div style={{ background: "#0b1220", border: "1px solid #1e293b", borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900 }}>Top routes (usable)</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>effective = base × (1+cong) × buffer</div>
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  {usableRoutes.slice(0, 3).map((r) => (
                    <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", borderRadius: 10, background: "#0f172a", border: "1px solid #1e293b" }}>
                      <div style={{ fontSize: 12, fontWeight: 900 }}>Route {r.id} <span style={{ fontSize: 10, marginLeft: 6, color: r.status === "CAUTION" ? "#f59e0b" : "#22c55e" }}>{r.status}</span></div>
                      <div style={{ fontFamily: "monospace", fontWeight: 900 }}>{r.eff.toFixed(1)}h</div>
                    </div>
                  ))}
                  {!usableRoutes.length && <div style={{ fontSize: 12, color: "#fca5a5" }}>사용 가능한 루트 없음</div>}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 10 }}>📦 Conflict Stats</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
              <div style={{ background: "#0b1220", border: "1px solid #1e293b", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, color: "#64748b" }}>Missiles</div>
                <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", marginTop: 4 }}>{stat(derived.conflictStats.missiles_total)}</div>
                <div style={{ fontSize: 10, color: "#94a3b8" }}>intercepted: {stat(derived.conflictStats.missiles_intercepted)}</div>
              </div>
              <div style={{ background: "#0b1220", border: "1px solid #1e293b", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, color: "#64748b" }}>Drones</div>
                <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", marginTop: 4 }}>{stat(derived.conflictStats.drones_total)}</div>
                <div style={{ fontSize: 10, color: "#94a3b8" }}>destroyed: {stat(derived.conflictStats.drones_destroyed)}</div>
              </div>
              <div style={{ background: "#0b1220", border: "1px solid #1e293b", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, color: "#64748b" }}>Casualties</div>
                <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", marginTop: 4 }}>{stat(derived.conflictStats.casualties_kia)} KIA</div>
                <div style={{ fontSize: 10, color: "#94a3b8" }}>{stat(derived.conflictStats.casualties_wia)} WIA</div>
              </div>
              <div style={{ background: "#0b1220", border: "1px solid #1e293b", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, color: "#64748b" }}>Duration / Source</div>
                <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", marginTop: 4 }}>{derived.conflictDayLabel}</div>
                <div style={{ fontSize: 10, color: "#94a3b8" }}>{derived.conflictStats.conflict_start_date || "n/a"} · {derived.conflictSourceLabel}</div>
              </div>
            </div>
          </Card>

          <Card>
            <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 10 }}>⚙️ Key Assumptions</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 8 }}>
              {KEY_ASSUMPTIONS.map((item) => (
                <div
                  key={item.id}
                  style={{
                    background: item.status === "warn" ? "rgba(245,158,11,0.06)" : "#0b1220",
                    border: `1px solid ${item.status === "warn" ? "#92400e" : "#1e293b"}`,
                    borderRadius: 8,
                    padding: 10
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 900, fontFamily: "monospace", color: "#e2e8f0" }}>{item.id}</span>
                    <span style={{ fontSize: 13, color: item.status === "warn" ? "#f59e0b" : "#94a3b8" }}>{item.text}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>실패 시: {item.fail}</div>
                  <div style={{ fontSize: 11, color: item.status === "warn" ? "#fbbf24" : "#475569", marginTop: 4 }}>검증: {item.verified}</div>
                </div>
              ))}
            </div>
          </Card>

          {dash.aiAnalysis && (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 900 }}>🧠 NotebookLM AI Analysis</div>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
                    source: {dash.aiAnalysis.analysis_source || "—"} · {dash.aiAnalysis.updated_at ? formatTimeGST(dash.aiAnalysis.updated_at) : "—"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {dash.aiAnalysis.threat_level && (
                    <span style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 900, color: dash.aiAnalysis.threat_level === "CRITICAL" ? "#ef4444" : dash.aiAnalysis.threat_level === "HIGH" ? "#f97316" : dash.aiAnalysis.threat_level === "MEDIUM" ? "#eab308" : "#22c55e" }}>
                      {dash.aiAnalysis.threat_level}
                    </span>
                  )}
                  {dash.aiAnalysis.sentiment && (
                    <span style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "4px 10px", fontSize: 11, color: "#94a3b8" }}>
                      {dash.aiAnalysis.sentiment}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ marginTop: 12, background: "#0b1220", border: "1px solid #1e293b", borderRadius: 12, padding: 12 }}>
                {dash.aiAnalysis.summary && (
                  <div style={{ fontSize: 12, whiteSpace: "pre-wrap", color: "#e2e8f0", marginBottom: 8 }}>{dash.aiAnalysis.summary}</div>
                )}
                {dash.aiAnalysis.recommended_action && (
                  <div style={{ fontSize: 11, color: "#fbbf24", borderTop: "1px solid #1e293b", paddingTop: 8 }}>
                    권고: {dash.aiAnalysis.recommended_action}
                  </div>
                )}
                {dash.aiAnalysis.key_points?.length > 0 && (
                  <ul style={{ margin: "8px 0 0 0", paddingLeft: 16, fontSize: 11, color: "#94a3b8" }}>
                    {dash.aiAnalysis.key_points.map((pt, i) => <li key={i}>{pt}</li>)}
                  </ul>
                )}
              </div>
            </Card>
          )}
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 900 }}>🤖 AI-ish Situation Summary</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>룰 기반 요약(오프라인). auto summary를 켜면 업데이트마다 생성.</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11, color: "#cbd5e1" }}>
                  <input type="checkbox" checked={autoSummary} onChange={(e) => setAutoSummary(e.target.checked)} /> auto summary
                </label>
                <button onClick={() => { const text = buildOfflineSummary(dash, derived); setSummary({ text, ts: new Date().toISOString(), mode: "OFFLINE" }); logEvent({ level: "INFO", category: "SUMMARY", title: "Summary generated" }); }} style={{ background: "#0b1220", border: "1px solid #1e293b", color: "#e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 11, fontWeight: 900, cursor: "pointer" }}>Generate</button>
                <button onClick={async () => { const ok = await tryCopyText(summary.text); logEvent({ level: ok ? "INFO" : "WARN", category: "SUMMARY", title: ok ? "Summary copied" : "Copy failed" }); }} style={{ background: "#0b1220", border: "1px solid #1e293b", color: "#e2e8f0", borderRadius: 10, padding: "10px 12px", fontSize: 11, fontWeight: 900, cursor: "pointer" }}>Copy</button>
              </div>
            </div>
            <div style={{ marginTop: 12, background: "#0b1220", border: "1px solid #1e293b", borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 10, color: "#64748b" }}>{summary.ts ? `last: ${formatTimeGST(summary.ts)} · mode=${summary.mode}` : "no summary yet"}</div>
              <div style={{ marginTop: 10, fontSize: 12, whiteSpace: "pre-wrap", color: "#e2e8f0" }}>{summary.text || "—"}</div>
            </div>
          </Card>
        </div>
      )}

      {tab === "analysis" && (
        <div>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 900 }}>📈 Hypothesis Trend Graph</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>최근 {history.length} 포인트 (최대 {HISTORY_MAX_POINTS})</div>
              </div>
              <button onClick={() => { setHistory([]); logEvent({ level: "INFO", category: "SYSTEM", title: "History cleared" }); }} style={{ background: "#0b1220", border: "1px solid #1e293b", color: "#94a3b8", borderRadius: 10, padding: "10px 12px", fontSize: 11, fontWeight: 900, cursor: "pointer" }}>Reset history</button>
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
            <TimelinePanel timeline={timeline} onClear={() => { setTimeline([]); logEvent({ level: "INFO", category: "SYSTEM", title: "Timeline cleared" }); }} onExport={exportTimeline} />
          </Card>
        </div>
      )}

      {tab === "intel" && (
        <div>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 900 }}>🔴 Intel Feed</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>최신순</div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {(dash.intelFeed || []).map((f) => (
                <div key={f.id} style={{ background: "#0b1220", border: "1px solid #1e293b", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 10, color: "#64748b" }}>{formatTimeGST(f.tsIso)}</div>
                    <div style={{ fontSize: 10, color: f.priority === "CRITICAL" ? "#ef4444" : f.priority === "HIGH" ? "#f59e0b" : "#94a3b8", fontWeight: 900 }}>{f.priority}</div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: "#e2e8f0" }}>{f.text}</div>
                  <div style={{ marginTop: 6, fontSize: 10, color: "#64748b" }}>sources: {f.sources || "n/a"}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "indicators" && (
        <div>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 900 }}>📡 Indicators</div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {(dash.indicators || []).map((ind) => {
                const color = ind.state >= 0.8 ? "#ef4444" : ind.state >= 0.4 ? "#f59e0b" : "#22c55e";
                return (
                  <div key={ind.id} style={{ background: "#0b1220", border: "1px solid #1e293b", borderRadius: 12, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 42, textAlign: "center", fontSize: 12, fontWeight: 900, fontFamily: "monospace", color }}>{ind.id}</div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 800 }}>{ind.name}</span>
                            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 999, background: ind.tier === "TIER0" ? "rgba(239,68,68,0.15)" : ind.tier === "TIER1" ? "rgba(245,158,11,0.15)" : "rgba(100,116,139,0.15)", color: ind.tier === "TIER0" ? "#fca5a5" : ind.tier === "TIER1" ? "#fcd34d" : "#94a3b8", fontWeight: 900 }}>{ind.tier}</span>
                            <span style={{ fontSize: 12, fontWeight: 900, fontFamily: "monospace", color }}>{ind.state.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: 10, color: ind.cv ? "#22c55e" : "#f59e0b", fontWeight: 900 }}>{ind.cv ? "✓ 교차검증" : "△ 부분"}</span>
                    </div>
                    <div style={{ marginTop: 10 }}><Bar value={ind.state} color={color} h={8} /></div>
                    <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 10 }}>{ind.detail}</div>
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>출처: {ind.src || "n/a"} · 최신: {formatTimeGST(ind.tsIso)} · 소스 {Math.max(ind.srcCount || 0, 0)}건</div>
                  </div>
                );
              })}
            </div>
            <div style={{ background: "#0b1220", border: "1px solid #1e293b", borderRadius: 12, padding: 14, marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: derived.evidenceFloorPassed ? "#22c55e" : "#f59e0b" }}>
                {derived.evidenceFloorPassed ? "✅ Evidence Floor PASSED" : "⚠ Evidence Floor not reached"} — TIER0 교차검증: {derived.evidenceFloorT0}건
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === "routes" && (
        <div>
          <Card>
            <RouteMapLeaflet routes={dash.routes} routeGeo={dash.routeGeo} selectedId={selectedRouteId} onSelect={(rid) => setSelectedRouteId((prev) => (prev === rid ? null : rid))} />
            {selectedRouteId && (
              <div style={{ marginTop: 12, background: "#0b1220", border: "1px solid #1e293b", borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900 }}>Selected Route: {selectedRouteId}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>아래 카드에서 해당 Route가 하이라이트됩니다.</div>
              </div>
            )}
          </Card>
          {(dash.routes || []).map((r) => {
            const eff = r.base_h * (1 + (r.cong ?? r.congestion ?? 0)) * ROUTE_BUFFER_FACTOR;
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
                    <div style={{ fontSize: 10, color: "#64748b" }}>{isBlocked ? "차단" : `effective (buffer x${ROUTE_BUFFER_FACTOR})`}</div>
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
      )}

      {tab === "sim" && <div><Simulator liveDash={dash} onLog={logEvent} /></div>}

      {tab === "checklist" && (
        <div>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 900 }}>✅ Checklist</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>준비 완료 체크(로컬 저장)</div>
              </div>
              <button onClick={() => { setDash((prev) => ({ ...prev, checklist: (prev.checklist || []).map((c) => ({ ...c, done: false })) })); logEvent({ level: "INFO", category: "CHECKLIST", title: "Checklist reset" }); }} style={{ background: "#0b1220", border: "1px solid #1e293b", color: "#94a3b8", borderRadius: 10, padding: "10px 12px", fontSize: 11, fontWeight: 900, cursor: "pointer" }}>Reset</button>
            </div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {(dash.checklist || []).map((c) => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, background: "#0b1220", border: "1px solid #1e293b", cursor: "pointer" }}>
                  <input type="checkbox" checked={Boolean(c.done)} onChange={() => setDash((prev) => ({ ...prev, checklist: (prev.checklist || []).map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)) }))} />
                  <div style={{ fontSize: 12, color: c.done ? "#86efac" : "#e2e8f0", fontWeight: 800 }}>{c.text}</div>
                </label>
              ))}
            </div>
          </Card>

          <Card>
            <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 10 }}>📋 Version / Changelog</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {VERSION_HISTORY.map((v, i) => (
                <div key={`${v.v}-${i}`} style={{ background: v.active ? "rgba(124,58,237,0.10)" : "#0b1220", border: `1px solid ${v.active ? "#7c3aed" : "#1e293b"}`, borderRadius: 10, padding: "10px 12px", display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ minWidth: 86, fontFamily: "monospace", fontSize: 12, fontWeight: 900, color: v.active ? "#a78bfa" : "#94a3b8" }}>{v.v}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "#e2e8f0" }}>{v.desc}</div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>{v.change}</div>
                  </div>
                  {v.active ? <span style={{ fontSize: 10, background: "#7c3aed", color: "#fff", padding: "2px 8px", borderRadius: 999, fontWeight: 900 }}>ACTIVE</span> : null}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 10, color: "#475569", textAlign: "center" }}>
        {loading ? "loading…" : "ready"} · source: {derived.liveSource} · sourceHealth: {derived.sourceHealthLabel} · conflict_stats: {derived.conflictSourceLabel} · lag: {lagLabel}
      </div>
    </div>
  );
}
