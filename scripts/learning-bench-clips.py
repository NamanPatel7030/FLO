#!/usr/bin/env python3
"""Make the screen-aware vocabulary clips (macOS `say`, 16 kHz mono WAV) and a manifest.

    python3 scripts/learning-bench-clips.py /tmp/flo-learning-clips
    cd src-tauri && FLO_LEARN_MANIFEST=/tmp/flo-learning-clips/manifest.json \
      cargo test --release --lib learning_bench -- --ignored --nocapture

Each clip has names / jargon the speech model doesn't know, the text a window would show while the
user dictates into it ("screen", what Flo reads around the focus) and the terms that must come out
spelled exactly ("terms"). The control clips are full of everyday words that are also names on
screen ("will", "mark", "may"), to catch false corrections.
"""
import json, os, subprocess, sys

SLACK = """Avenuor
# avenuor-dev
# general
Direct messages
Priya Shah
Rahul Mehta
Naman Patel
Priya Shah 10:42 AM
the Tauri build is green on CI, can someone ship it?
Rahul Mehta 10:44 AM
I'll check the Supabase migration first
Message #avenuor-dev"""

CODE = """flo-mvp — src-tauri/src/session.rs
Hetzner Cloud console
kubectl get pods -n flo
Kubernetes cluster flo-prod: 3 nodes
Zustand store, useStore()
GitHub Actions: release.yml
Ishaan Verma opened a pull request"""

FRIENDS = """Aarav Joshi
Diya Kapoor
Lunch plans?
Smoor, Indiranagar
Notchling avatar in Figma
Will Turner
Mark Evans
May Chen"""

# (name, voice, text, screen, terms)
clips = [
 ("tauri", "Samantha", "Send the Tauri build to Priya and Rahul on Avenuor.", SLACK, ["Tauri", "Priya", "Rahul", "Avenuor"]),
 ("tauri_in", "Rishi", "Send the Tauri build to Priya and Rahul on Avenuor.", SLACK, ["Tauri", "Priya", "Rahul", "Avenuor"]),
 ("supabase", "Rishi", "Ask Naman to review the Supabase migration before Friday.", SLACK, ["Naman", "Supabase"]),
 ("hetzner", "Daniel", "The Kubernetes pods on the Hetzner cluster are crashing again.", CODE, ["Kubernetes", "Hetzner"]),
 ("zustand", "Samantha", "Can Ishaan push the Zustand store fix to GitHub tonight?", CODE, ["Ishaan", "Zustand", "GitHub"]),
 ("kubectl", "Rishi", "Run kubectl get pods on the Hetzner box.", CODE, ["kubectl", "Hetzner"]),
 ("smoor", "Karen", "Lunch with Aarav and Diya at Smoor tomorrow.", FRIENDS, ["Aarav", "Diya", "Smoor"]),
 ("notchling", "Samantha", "Please update the Figma file for the Notchling avatar.", FRIENDS, ["Figma", "Notchling"]),
 ("control1", "Samantha", "I will mark this as done and we may move on.", FRIENDS, []),
 ("control2", "Rishi", "Let me know when you are free to talk about the budget.", SLACK, []),
 ("control3", "Daniel", "The story is ready, but the tour needs a new date.", SLACK, []),
]

RATE = "165"


def render(out, name, voice, text):
    aiff, wav = os.path.join(out, name + ".aiff"), os.path.join(out, name + ".wav")
    subprocess.run(["say", "-v", voice, "-r", RATE, "-o", aiff, text], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav], check=True)
    os.remove(aiff)
    return wav


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/flo-learning-clips"
    os.makedirs(out, exist_ok=True)
    man = []
    for name, voice, text, screen, terms in clips:
        wav = render(out, name, voice, text)
        man.append({"name": name, "voice": voice, "text": text, "screen": screen, "terms": terms, "wav": wav})
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(man, f, ensure_ascii=False, indent=1)
    print(f"{len(man)} clips in {out}")


if __name__ == "__main__":
    main()
