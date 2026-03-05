"""
헬스체크 API (Phase 1 안정화)
==============================
FastAPI 엔드포인트:
- GET /health
- GET /api/state
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from datetime import datetime, timezone

from fastapi import FastAPI

from .config import settings
from .state_engine import warming_up_payload

app = FastAPI(title="Iran-UAE Monitor Health")
_storage_root = Path(settings.STORAGE_ROOT)
if not _storage_root.is_absolute():
    _storage_root = (Path(__file__).resolve().parents[2] / _storage_root).resolve()

HEALTH_STATE_FILE = (_storage_root / settings.HEALTH_STATE_FILE).resolve()
HYIE_STATE_FILE = (_storage_root / settings.HYIE_STATE_FILE).resolve()
HYIE_EGRESS_ETA_FILE = (_storage_root / settings.HYIE_EGRESS_ETA_FILE).resolve()


def _read_json_file(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    return payload


@app.get("/health")
def health():
    """마지막 파이프라인 실행 상태 및 성공 시각/기사 수 반환."""
    data = _read_json_file(HEALTH_STATE_FILE)
    if data is None:
        return {
            "status": "unknown",
            "message": "아직 한 번도 실행되지 않음",
        }

    last_success_at = data.get("last_success_at")
    last_run_ts = data.get("last_run_ts", last_success_at)
    return {
        "status": data.get("status", "unknown"),
        "last_success_at": last_success_at,
        "last_run_ts": last_run_ts,
        "last_article_count": data.get("last_article_count", data.get("counts", {}).get("new_count")),
        "counts": data.get("counts") or {},
        "last_error": data.get("last_error"),
    }


@app.get("/api/state")
def api_state() -> dict[str, Any]:
    """HyIE-ERC² 상태 payload 반환. 파일이 없으면 warming_up 상태를 반환."""
    data = _read_json_file(HYIE_STATE_FILE)
    if data is None:
        return warming_up_payload()

    required_keys = {
        "state_ts",
        "status",
        "source_health",
        "degraded",
        "flags",
        "intel_feed",
        "indicators",
        "hypotheses",
        "routes",
        "checklist",
    }
    missing = sorted(required_keys - set(data.keys()))
    if missing:
        payload = warming_up_payload()
        payload["flags"] = payload.get("flags", []) + [f"STATE_SCHEMA_MISSING:{','.join(missing)}"]
        payload["status"] = "warming_up"
        return payload

    return data


@app.get("/api/state/egress-eta")
def get_egress_eta() -> dict[str, Any]:
    payload = _read_json_file(HYIE_EGRESS_ETA_FILE) or {}
    return {
        "egress_loss_eta_h": payload.get("egress_loss_eta_h"),
        "note": payload.get("note"),
        "updated_at": payload.get("updated_at"),
        "source": "manual_file",
        "path": str(HYIE_EGRESS_ETA_FILE),
    }


@app.post("/api/state/egress-eta")
def set_egress_eta(body: dict[str, Any]) -> dict[str, Any]:
    raw = body.get("egress_loss_eta_h")
    if raw is None:
        return {"ok": False, "error": "egress_loss_eta_h is required"}
    try:
        hours = max(0.0, float(raw))
    except (TypeError, ValueError):
        return {"ok": False, "error": "egress_loss_eta_h must be numeric"}

    payload = {
        "egress_loss_eta_h": hours,
        "note": str(body.get("note") or ""),
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    HYIE_EGRESS_ETA_FILE.parent.mkdir(parents=True, exist_ok=True)
    HYIE_EGRESS_ETA_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, **payload}


@app.get("/")
def root():
    """엔드포인트 안내."""
    return {
        "service": "Iran-UAE Monitor",
        "health": "/health",
        "state": "/api/state",
        "egress_eta": "/api/state/egress-eta",
    }
