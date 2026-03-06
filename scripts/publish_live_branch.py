#!/usr/bin/env python
"""Publish the generated live directory to the urgentdash-live branch."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def _run(args: list[str], *, cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(cwd),
        check=check,
        text=True,
        capture_output=True,
    )


def _copy_live(source: Path, target: Path) -> None:
    dest = target / "live"
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(source, dest)


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish live/ to a Git branch")
    parser.add_argument("--source-live-dir", required=True, help="Source live directory")
    parser.add_argument("--repo", required=True, help="GitHub repo slug, e.g. owner/name")
    parser.add_argument("--token", required=True, help="GitHub token for push")
    parser.add_argument("--branch", default="urgentdash-live", help="Target branch")
    parser.add_argument("--commit-message", default="chore: update live payloads [skip ci]", help="Commit message")
    parser.add_argument("--user-name", default="github-actions[bot]", help="Git author name")
    parser.add_argument(
        "--user-email",
        default="github-actions[bot]@users.noreply.github.com",
        help="Git author email",
    )
    args = parser.parse_args()

    source_live = Path(args.source_live_dir).resolve()
    if not source_live.exists():
        print(f"live directory not found: {source_live}", file=sys.stderr)
        return 1

    remote_url = f"https://x-access-token:{args.token}@github.com/{args.repo}.git"

    with tempfile.TemporaryDirectory(prefix="urgentdash-live-") as temp_dir:
        workdir = Path(temp_dir)
        _run(["git", "init"], cwd=workdir)
        _run(["git", "config", "user.name", args.user_name], cwd=workdir)
        _run(["git", "config", "user.email", args.user_email], cwd=workdir)
        _run(["git", "remote", "add", "origin", remote_url], cwd=workdir)

        fetched = _run(
            ["git", "fetch", "--depth", "1", "origin", args.branch],
            cwd=workdir,
            check=False,
        )
        if fetched.returncode == 0:
            _run(["git", "checkout", "-B", args.branch, "FETCH_HEAD"], cwd=workdir)
        else:
            _run(["git", "checkout", "--orphan", args.branch], cwd=workdir)
            for item in workdir.iterdir():
                if item.name == ".git":
                    continue
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()

        _copy_live(source_live, workdir)
        _run(["git", "add", "live"], cwd=workdir)
        diff = _run(["git", "diff", "--cached", "--quiet"], cwd=workdir, check=False)
        if diff.returncode == 0:
            print("No live changes to publish")
            return 0

        _run(["git", "commit", "-m", args.commit_message], cwd=workdir)
        push = _run(["git", "push", "origin", f"HEAD:{args.branch}"], cwd=workdir, check=False)
        if push.returncode != 0:
            print(push.stdout, file=sys.stderr)
            print(push.stderr, file=sys.stderr)
            return push.returncode

    print(f"Published live directory to {args.branch}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
