#!/usr/bin/env python
"""Export current HyIE state into versioned live payloads for dashboard polling."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

from src.iran_monitor.config import settings

REQUIRED_KEYS = {
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


def _storage_root() -> Path:
    base = Path(settings.STORAGE_ROOT)
    if base.is_absolute():
        return base
    return (ROOT / base).resolve()


def _load_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON object required: {path}")
    return payload


def _dump_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _strip_ai_analysis(payload: dict) -> dict:
    lite = dict(payload)
    lite.pop("ai_analysis", None)
    return lite


def _compute_version(meta_payload: dict | None, lite_payload: dict) -> str:
    raw = str((meta_payload or {}).get("state_hash") or "").strip()
    if raw:
        return raw
    from hashlib import sha1

    return sha1(
        json.dumps(lite_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def _compute_ai_version(ai_analysis: dict | None) -> str | None:
    if not isinstance(ai_analysis, dict) or not ai_analysis:
        return None
    from hashlib import sha1

    return sha1(
        json.dumps(ai_analysis, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def _load_latest(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        payload = _load_json(path)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _load_previous_ai_patch(out_dir: Path, latest_payload: dict) -> dict | None:
    ai_path = str(latest_payload.get("aiPath") or "").strip()
    if not ai_path:
        return None
    candidate = out_dir / ai_path
    if not candidate.exists():
        return None
    try:
        payload = _load_json(candidate)
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _update_health_after_publish(
    *,
    health_file: Path,
    version: str,
    published_at: str,
    ai_mode: str | None,
) -> None:
    data: dict = {}
    if health_file.exists():
        try:
            data = _load_json(health_file)
        except Exception:
            data = {}
    data["last_publish_success_at"] = published_at
    data["published_version"] = version
    if ai_mode:
        data["ai_mode"] = ai_mode
    _dump_json(health_file, data)


def main() -> int:
    parser = argparse.ArgumentParser(description="Export live HyIE state payload")
    parser.add_argument(
        "--state-file",
        default=str(_storage_root() / settings.HYIE_STATE_FILE),
        help="Path to source HyIE state JSON",
    )
    parser.add_argument(
        "--meta-file",
        default=str(_storage_root() / settings.HYIE_STATE_META_FILE),
        help="Path to HyIE state meta JSON",
    )
    parser.add_argument(
        "--health-file",
        default=str(_storage_root() / settings.HEALTH_STATE_FILE),
        help="Path to health state JSON",
    )
    parser.add_argument(
        "--out-dir",
        default=str(ROOT / "live"),
        help="Output directory for static live payload",
    )
    parser.add_argument(
        "--publish-mode",
        choices=("lite", "ai", "full"),
        default="full",
        help="Publish lite only, ai patch, or full merged payload",
    )
    args = parser.parse_args()

    state_file = Path(args.state_file)
    meta_file = Path(args.meta_file)
    health_file = Path(args.health_file)
    out_dir = Path(args.out_dir)

    if not state_file.exists():
        print(f"Error: state file not found: {state_file}", file=sys.stderr)
        return 1

    payload = _load_json(state_file)
    missing = sorted(REQUIRED_KEYS - set(payload.keys()))
    if missing:
        print(f"Error: state file missing required key(s): {', '.join(missing)}", file=sys.stderr)
        return 1

    lite_payload = _strip_ai_analysis(payload)
    meta_payload = _load_json(meta_file) if meta_file.exists() else {}
    version = _compute_version(meta_payload, lite_payload)
    ai_analysis = payload.get("ai_analysis") if isinstance(payload.get("ai_analysis"), dict) else None
    ai_version = _compute_ai_version(ai_analysis)
    ai_mode = str((ai_analysis or {}).get("analysis_source") or "").strip().lower() or None
    published_at = _now_utc()
    latest_file = out_dir / "latest.json"
    latest_prev = _load_latest(latest_file)

    lite_rel = f"v/{version}/state-lite.json"
    ai_rel = f"v/{version}/state-ai.json" if ai_version else None
    previous_ai_patch = _load_previous_ai_patch(out_dir, latest_prev)

    latest_payload = {
        "version": version,
        "aiVersion": None,
        "publishedAt": published_at,
        "stateTs": lite_payload.get("state_ts"),
        "aiUpdatedAt": None,
        "status": lite_payload.get("status"),
        "degraded": lite_payload.get("degraded"),
        "aiMode": None,
        "litePath": lite_rel,
        "aiPath": None,
    }

    _dump_json(out_dir / lite_rel, lite_payload)

    current_ai_patch = None
    if args.publish_mode in {"ai", "full"} and ai_analysis and ai_version:
        ai_patch = {
            "ai_analysis": ai_analysis,
            "ai_mode": ai_mode or "fallback",
            "ai_updated_at": ai_analysis.get("updated_at"),
            "source_version": version,
        }
        _dump_json(out_dir / ai_rel, ai_patch)
        current_ai_patch = ai_patch
        latest_payload["aiVersion"] = ai_version
        latest_payload["aiUpdatedAt"] = ai_patch.get("ai_updated_at")
        latest_payload["aiMode"] = ai_patch.get("ai_mode")
        latest_payload["aiPath"] = ai_rel
    elif latest_prev:
        latest_payload["aiVersion"] = latest_prev.get("aiVersion")
        latest_payload["aiUpdatedAt"] = latest_prev.get("aiUpdatedAt")
        latest_payload["aiMode"] = latest_prev.get("aiMode")
        latest_payload["aiPath"] = latest_prev.get("aiPath")

    legacy_payload = dict(lite_payload)
    merged_ai_analysis = None
    if current_ai_patch and isinstance(current_ai_patch.get("ai_analysis"), dict):
        merged_ai_analysis = current_ai_patch.get("ai_analysis")
    elif previous_ai_patch and isinstance(previous_ai_patch.get("ai_analysis"), dict):
        merged_ai_analysis = previous_ai_patch.get("ai_analysis")
    if latest_payload.get("aiVersion") and isinstance(merged_ai_analysis, dict):
        legacy_payload["ai_analysis"] = merged_ai_analysis
    _dump_json(out_dir / "hyie_state.json", legacy_payload)
    _dump_json(latest_file, latest_payload)
    _dump_json(
        out_dir / "last_updated.json",
        {
            "published_at": published_at,
            "state_ts": lite_payload.get("state_ts"),
            "status": lite_payload.get("status"),
            "degraded": lite_payload.get("degraded"),
            "version": version,
            "ai_version": latest_payload.get("aiVersion"),
            "ai_mode": latest_payload.get("aiMode"),
        },
    )
    _update_health_after_publish(
        health_file=health_file,
        version=version,
        published_at=published_at,
        ai_mode=latest_payload.get("aiMode"),
    )

    print(f"Exported: {out_dir / lite_rel}")
    if latest_payload.get("aiPath"):
        print(f"Exported: {out_dir / latest_payload['aiPath']}")
    print(f"Exported: {out_dir / 'hyie_state.json'}")
    print(f"Exported: {latest_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
