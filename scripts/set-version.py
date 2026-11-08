"""Set Flo's version everywhere it lives: tauri.conf.json, Cargo.toml and package.json."""
import json
import re
import sys
from pathlib import Path

v = sys.argv[1]
root = Path(__file__).resolve().parent.parent

p = root / "src-tauri/tauri.conf.json"
c = json.loads(p.read_text())
c["version"] = v
p.write_text(json.dumps(c, indent=2, ensure_ascii=False) + "\n")

p = root / "src-tauri/Cargo.toml"
s = p.read_text()
# only the [package] version (the first `version = ` line in the file)
s = re.sub(r'(?m)^version = "[^"]*"', f'version = "{v}"', s, count=1)
p.write_text(s)

p = root / "package.json"
s = p.read_text()
s = re.sub(r'("version":\s*")[^"]*(")', rf"\g<1>{v}\g<2>", s, count=1)
p.write_text(s)
print(f"version → {v}")
