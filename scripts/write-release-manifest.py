"""Write website/releases/latest.json for the update server.

usage: write-release-manifest.py <version> <platform-key> <file-name> <sig-path> [notes]
Keeps other platforms' entries when they are for the same version (so a Windows build can be added
to the same release later)."""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

version, key, name, sig_path = sys.argv[1:5]
notes = sys.argv[5] if len(sys.argv) > 5 else ""
root = Path(__file__).resolve().parent.parent
out = root / "website/releases/latest.json"
out.parent.mkdir(parents=True, exist_ok=True)

base = os.environ.get("RELEASE_BASE_URL", "").rstrip("/")
url = f"{base}/{name}" if base else f"/releases/{version}/{name}"

old = {}
if out.exists():
    try:
        old = json.loads(out.read_text())
    except Exception:
        old = {}
platforms = old.get("platforms", {}) if old.get("version") == version else {}
platforms[key] = {"url": url, "signature": Path(sig_path).read_text().strip()}

manifest = {
    "version": version,
    "notes": notes or old.get("notes", "") if old.get("version") == version else notes,
    "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": platforms,
}
out.write_text(json.dumps(manifest, indent=2) + "\n")
print(f"latest.json → {version} ({', '.join(platforms)})")
