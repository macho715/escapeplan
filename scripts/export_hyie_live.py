#!/usr/bin/env python
"""Export current HyIE state into a static live payload for dashboard polling."""

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


def main() -> int:
    parser = argparse.ArgumentParser(description="Export live HyIE state payload")
    parser.add_argument(
        "--state-file",
        default=str(_storage_root() / settings.HYIE_STATE_FILE),
        help="Path to source HyIE state JSON",
    )
    parser.add_argument(
        "--out-dir",
        default=str(ROOT / "live"),
        help="Output directory for static live payload",
    )
    args = parser.parse_args()

    state_file = Path(args.state_file)
    out_dir = Path(args.out_dir)

    if not state_file.exists():
        print(f"Error: state file not found: {state_file}", file=sys.stderr)
        return 1

    payload = _load_json(state_file)
    missing = sorted(REQUIRED_KEYS - set(payload.keys()))
    if missing:
        print(f"Error: state file missing required key(s): {', '.join(missing)}", file=sys.stderr)
        return 1

    out_state_file = out_dir / "hyie_state.json"
    out_meta_file = out_dir / "last_updated.json"
    _dump_json(out_state_file, payload)
    _dump_json(
        out_meta_file,
        {
            "published_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "state_ts": payload.get("state_ts"),
            "status": payload.get("status"),
            "degraded": payload.get("degraded"),
        },
    )

    print(f"Exported: {out_state_file}")
    print(f"Exported: {out_meta_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

