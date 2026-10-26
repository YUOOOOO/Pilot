"""Verify the recorded nanoMuse extraction using only Python's standard library.

Run from any directory: python scripts/verify_upstream.py
This checks source integrity and required inputs, not application behavior.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "docs/upstream/files.json"


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    problems: list[str] = []
    seen: set[str] = set()
    adaptations = {entry["path"]: entry for entry in manifest.get("localSourceChanges", [])}
    for entry in manifest["files"]:
        relative = PurePosixPath(entry["path"])
        if relative.is_absolute() or ".." in relative.parts or ":" in entry["path"]:
            problems.append(f"unsafe path: {relative}")
            continue
        if str(relative).casefold() in seen:
            problems.append(f"duplicate path: {relative}")
        seen.add(str(relative).casefold())
        target = ROOT.joinpath(*relative.parts)
        if not target.is_file():
            problems.append(f"missing: {relative}")
        elif hashlib.sha256(target.read_bytes()).hexdigest() != adaptations.get(str(relative), entry)["sha256"]:
            problems.append(f"changed: {relative}")
    desktop = json.loads((ROOT / "harness/desktop/package.json").read_text(encoding="utf-8"))
    bundle = json.loads((ROOT / "harness/dsh-nanomuse/package.json").read_text(encoding="utf-8"))
    if desktop["version"] != bundle["version"]:
        problems.append("desktop and bundle versions differ")
    if desktop["devDependencies"]["electron"] != manifest["versions"]["electron"]:
        problems.append("Electron differs from recorded baseline")
    if bundle["peerDependencies"]["@deepseek-ai/dsh-agent"] != manifest["versions"]["dsh"]:
        problems.append("DSH differs from recorded baseline")
    for lang in ("en", "zh"):
        expected = (ROOT / f"harness/dsh-nanomuse/assets/ideas.{lang}.json").read_bytes()
        for path in (f"android/src/android/app/src/main/assets/nanomuse/ideas.{lang}.json",
                     f"android/src/ios/NanoMuse/Resources/ideas.{lang}.json"):
            if (ROOT / path).read_bytes() != expected:
                problems.append(f"fixture differs: {path}")
    if (ROOT / "nanomuse/llm/providers.json").read_bytes() != (ROOT / "harness/dsh-nanomuse/assets/providers.json").read_bytes():
        problems.append("runtime and desktop provider catalogues differ")
    for path in ("scripts/desktop-app/runtime_entry.py", "scripts/desktop-app/nanomuse_runtime.spec",
                 "nanomuse/server/static/index.html", "nanomuse/skills/builtin",
                 "config/config.example.toml", "THIRD_PARTY_NOTICES.md", "docs/upstream/nanomuse-NOTICE.txt"):
        if not (ROOT / path).exists():
            problems.append(f"missing runtime or notice input: {path}")
    for path in ("cloud/pyproject.toml", "cloud/nanomuse_cloud/api.py", "cloud/nanomuse_cloud/hub.py",
                 "cloud/nanomuse_cloud/console/index.html", "cloud/nanomuse_cloud/console/admin/index.html",
                 "cloud/requirements.lock", "cloud/Pilot.Dockerfile", "cloud/Pilot.Dockerfile.dockerignore",
                 "cloud/compose.pilot.yml", "cloud/Pilot.Caddyfile", "scripts/pilot-relay.py",
                 "cloud/pilot-public/privacy.html", "cloud/pilot-public/own-key.html", "docs/RELAY.md"):
        if not (ROOT / path).is_file():
            problems.append(f"missing relay input: {path}")
    if problems:
        print("\n".join(problems))
        return 1
    print(f"PASS: {len(manifest['files'])} imported files verified against nanoMuse {manifest['commit']} and {len(adaptations)} recorded Pilot adaptations")
    print(f"PASS: desktop {desktop['version']}, Electron {manifest['versions']['electron']}, DSH {manifest['versions']['dsh']}")
    print("PASS: runtime inputs, notices, provider catalogue and cross-platform test fixtures")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
