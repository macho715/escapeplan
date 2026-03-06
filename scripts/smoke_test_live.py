#!/usr/bin/env python
"""Smoke test the published live payloads on urgentdash-live."""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

from src.iran_monitor.config import settings

LATEST_REQUIRED_KEYS = {
    "version",
    "publishedAt",
    "stateTs",
    "status",
    "degraded",
    "litePath",
}

STATE_REQUIRED_KEYS = {
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


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _now_utc_text() -> str:
    return _now_utc().isoformat(timespec="seconds").replace("+00:00", "Z")


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def _load_json_url(url: str, timeout: float = 20.0) -> dict:
    with urlopen(url, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError(f"JSON object required: {url}")
    return payload


def _dump_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_health(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _update_health(health_file: Path, *, status: str, latest: dict | None, error: str | None) -> None:
    payload = _load_health(health_file)
    payload["last_smoke_test_at"] = _now_utc_text()
    payload["last_smoke_test_status"] = status
    if latest:
        payload["published_version"] = latest.get("version") or payload.get("published_version")
    if error:
        payload["last_error"] = error
    elif status == "ok":
        payload.pop("last_error", None)
    _dump_json(health_file, payload)


def _assert_keys(payload: dict, required: set[str], label: str) -> None:
    missing = sorted(required - set(payload.keys()))
    if missing:
        raise ValueError(f"{label} missing required keys: {', '.join(missing)}")


def _assert_fresh(ts_value: str | None, *, max_age_seconds: int, label: str) -> None:
    parsed = _parse_ts(ts_value)
    if parsed is None:
        raise ValueError(f"{label} timestamp invalid: {ts_value!r}")
    age = (_now_utc() - parsed).total_seconds()
    if age > max_age_seconds:
        raise ValueError(f"{label} too old: age={int(age)}s > {max_age_seconds}s")


def _fetch_latest_with_retry(url: str, retries: int, sleep_seconds: float) -> dict:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            return _load_json_url(url)
        except (HTTPError, URLError, ValueError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt == retries:
                break
            time.sleep(sleep_seconds * attempt)
    raise RuntimeError(f"latest fetch failed after {retries} attempt(s): {last_error}") from last_error


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke test published live payloads")
    parser.add_argument(
        "--latest-url",
        default="https://raw.githubusercontent.com/macho715/escapeplan/urgentdash-live/live/latest.json",
        help="Raw URL to live/latest.json",
    )
    parser.add_argument(
        "--health-file",
        default=str(_storage_root() / settings.HEALTH_STATE_FILE),
        help="Path to local health state file to update",
    )
    parser.add_argument(
        "--max-age-seconds",
        type=int,
        default=45 * 60,
        help="Maximum allowed age for stateTs",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=5,
        help="Number of fetch retries for latest.json",
    )
    parser.add_argument(
        "--retry-sleep-seconds",
        type=float,
        default=5.0,
        help="Base sleep between retries",
    )
    args = parser.parse_args()

    health_file = Path(args.health_file)
    latest_payload: dict | None = None

    try:
        latest_payload = _fetch_latest_with_retry(args.latest_url, args.retries, args.retry_sleep_seconds)
        _assert_keys(latest_payload, LATEST_REQUIRED_KEYS, "latest.json")
        _assert_fresh(latest_payload.get("stateTs"), max_age_seconds=args.max_age_seconds, label="latest.stateTs")

        lite_url = urljoin(args.latest_url, str(latest_payload["litePath"]))
        lite_payload = _load_json_url(lite_url)
        _assert_keys(lite_payload, STATE_REQUIRED_KEYS, "state-lite.json")
        _assert_fresh(lite_payload.get("state_ts"), max_age_seconds=args.max_age_seconds, label="state-lite.state_ts")

        ai_path = str(latest_payload.get("aiPath") or "").strip()
        ai_version = str(latest_payload.get("aiVersion") or "").strip()
        if ai_path or ai_version:
            if not ai_path or not ai_version:
                raise ValueError("latest.json aiPath/aiVersion mismatch")
            ai_url = urljoin(args.latest_url, ai_path)
            ai_payload = _load_json_url(ai_url)
            if not isinstance(ai_payload.get("ai_analysis"), dict):
                raise ValueError("state-ai.json missing ai_analysis")
            if not str(ai_payload.get("source_version") or "").strip():
                raise ValueError("state-ai.json missing source_version")

        _update_health(health_file, status="ok", latest=latest_payload, error=None)
        print(f"Smoke test passed: {args.latest_url}")
        return 0
    except Exception as exc:
        _update_health(health_file, status="error", latest=latest_payload, error=f"{type(exc).__name__}: {exc}")
        print(f"Smoke test failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
