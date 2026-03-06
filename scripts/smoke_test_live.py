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


def _normalize_latest_payload(payload: dict) -> dict:
    version = str(payload.get("version") or "").strip()
    published_at = str(payload.get("publishedAt") or payload.get("collectedAt") or "").strip()
    state_ts = str(payload.get("stateTs") or payload.get("state_ts") or "").strip()
    lite_path = str(payload.get("litePath") or payload.get("liteUrl") or "").strip()
    ai_path = str(payload.get("aiPath") or payload.get("aiUrl") or "").strip()
    ai_version = str(payload.get("aiVersion") or "").strip()

    missing = []
    if not version:
        missing.append("version")
    if not published_at:
        missing.append("publishedAt|collectedAt")
    if not state_ts:
        missing.append("stateTs")
    if not lite_path:
        missing.append("litePath|liteUrl")
    if missing:
        raise ValueError(f"latest.json missing required keys: {', '.join(missing)}")

    if bool(ai_path) != bool(ai_version):
        raise ValueError("latest.json ai path/version mismatch")

    return {
        "version": version,
        "publishedAt": published_at,
        "stateTs": state_ts,
        "litePath": lite_path,
        "aiPath": ai_path,
        "aiVersion": ai_version,
    }


def _fetch_json_with_retry(url: str, retries: int, sleep_seconds: float, label: str) -> dict:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            return _load_json_url(url)
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt == retries:
                break
            time.sleep(sleep_seconds * attempt)
    raise RuntimeError(f"{label} fetch failed after {retries} attempt(s): {last_error}") from last_error


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
        help="Number of fetch retries for published JSON",
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
        raw_latest = _fetch_json_with_retry(args.latest_url, args.retries, args.retry_sleep_seconds, "latest")
        latest_payload = _normalize_latest_payload(raw_latest)
        _assert_fresh(latest_payload.get("publishedAt"), max_age_seconds=args.max_age_seconds, label="latest.publishedAt")
        _assert_fresh(latest_payload.get("stateTs"), max_age_seconds=args.max_age_seconds, label="latest.stateTs")

        lite_url = urljoin(args.latest_url, latest_payload["litePath"])
        lite_payload = _fetch_json_with_retry(lite_url, args.retries, args.retry_sleep_seconds, "state-lite")
        _assert_keys(lite_payload, STATE_REQUIRED_KEYS, "state-lite.json")
        _assert_fresh(lite_payload.get("state_ts"), max_age_seconds=args.max_age_seconds, label="state-lite.state_ts")

        ai_path = latest_payload["aiPath"]
        if ai_path:
            ai_url = urljoin(args.latest_url, ai_path)
            ai_payload = _fetch_json_with_retry(ai_url, args.retries, args.retry_sleep_seconds, "state-ai")
            if not isinstance(ai_payload.get("ai_analysis"), dict):
                raise ValueError("state-ai.json missing ai_analysis")
            if not str(ai_payload.get("version") or latest_payload["version"]).strip():
                raise ValueError("state-ai.json missing version")

        _update_health(health_file, status="ok", latest=latest_payload, error=None)
        print(f"Smoke test passed: {args.latest_url}")
        return 0
    except Exception as exc:
        _update_health(health_file, status="error", latest=latest_payload, error=f"{type(exc).__name__}: {exc}")
        print(f"Smoke test failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
