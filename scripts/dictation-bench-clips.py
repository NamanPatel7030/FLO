#!/usr/bin/env python3
"""Make the dictation / assistant accuracy clips (macOS `say`, 16 kHz mono WAV) and a manifest.

    python3 scripts/dictation-bench-clips.py /tmp/flo-dictation-clips
    cd src-tauri && FLO_DICT_MANIFEST=/tmp/flo-dictation-clips/manifest.json \
      cargo test --release --lib dictation_bench -- --ignored --nocapture

Indian English (Rishi; the en_IN Siri voices Aman and Tara change speed and garble words from run to run, so they are left out), US English (Samantha), Hindi (Lekha), Hinglish (Romanized
Hindi read by Rishi, and Devanagari Hinglish read by Lekha) and short assistant commands. The
harness (src-tauri/src/dictation_bench.rs) turns each clip into the scenarios a real microphone
produces (quiet, silence around it, first syllable cut by a late start, background noise) and
runs them through the same pipeline as the Flo key.

"alt" is a second accepted spelling: Hinglish may come out in Roman letters (Hinglish setting)
or in Devanagari (Auto, which writes Hindi speech in Hindi script, as meetings do).
"""
import json, os, subprocess, sys

# (name, voice, lang, kind, text, alt)
clips = [
 ("in_en1", "Rishi", "en", "dictation", "Send the updated deck to Rahul by Friday evening.", None),
 ("in_en2", "Rishi", "en", "dictation", "Can you draft a reply to Priya saying the invoice is attached?", None),
 ("in_en3", "Rishi", "en", "dictation", "Please book a table for four at the Taj on Saturday night.", None),
 ("in_en4", "Rishi", "en", "dictation", "I think the new build is really fast and the notch looks great.", None),
 ("in_en5", "Rishi", "en", "dictation", "The quarterly numbers look good, but we need to cut the marketing budget by ten percent.", None),
 ("in_en6", "Rishi", "en", "dictation", "Hey team, quick update. The release is on track for Thursday. Let me know if anything breaks before then.", None),
 ("us_en1", "Samantha", "en", "dictation", "Please review the pull request before lunch and leave comments on the authentication changes.", None),
 ("us_en2", "Samantha", "en", "dictation", "Okay, mark the invoice task as done and open Slack.", None),
 ("hi1", "Lekha", "hi", "dictation", "कल सुबह दस बजे मीटिंग है, सबको याद दिला देना।", None),
 ("hi2", "Lekha", "hi", "dictation", "मुझे राहुल को इनवॉइस भेजना है।", None),
 ("hi3", "Lekha", "hi", "dictation", "आज का काम पूरा हो गया, अब घर जा रहा हूँ।", None),
 ("hi4", "Lekha", "hi", "dictation", "क्या तुम शाम को बाज़ार से दूध और सब्ज़ी ले आओगे?", None),
 ("hien_r1", "Rishi", "hi-en", "dictation", "Kal ki meeting cancel kar do, client ne reschedule kiya hai.", "कल की मीटिंग कैंसल कर दो, क्लाइंट ने रीशेड्यूल किया है।"),
 ("hien_r2", "Rishi", "hi-en", "dictation", "Main paanch minute mein call karta hoon, tum deck ready rakho.", "मैं पांच मिनट में कॉल करता हूँ, तुम डेक रेडी रखो।"),
 ("hien_l1", "Lekha", "hi-en", "dictation", "Priya ko bolo ki presentation kal tak bhej de.", "प्रिया को बोलो कि प्रेजेंटेशन कल तक भेज दे।"),
 ("cmd1", "Rishi", "en", "assistant", "Add a to-do to call Priya tomorrow.", None),
 ("cmd2", "Samantha", "en", "assistant", "What's on my calendar?", None),
 ("cmd3", "Rishi", "en", "assistant", "Remind me to pay the electricity bill on Monday.", None),
 ("cmd4", "Rishi", "en", "assistant", "Send a message to Rahul saying I'm running late.", None),
 ("cmd5", "Rishi", "en", "assistant", "What's on my calendar today?", None),
 ("cmd6", "Lekha", "hi", "assistant", "कल सुबह नौ बजे मुझे याद दिलाना।", None),
]

RATE = "165"

# Hinglish read by Lekha is spoken from Devanagari, everything else from its own text
spoken = {"hien_l1": "प्रिया को बोलो कि प्रेजेंटेशन कल तक भेज दे।"}


def render(out, name, voice, text):
    aiff, wav = os.path.join(out, name + ".aiff"), os.path.join(out, name + ".wav")
    # -r: words per minute. The en_IN Siri voices default to ~300 wpm, twice a real speaker.
    subprocess.run(["say", "-v", voice, "-r", RATE, "-o", aiff, text], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav], check=True)
    os.remove(aiff)
    return wav


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/flo-dictation-clips"
    os.makedirs(out, exist_ok=True)
    man = []
    for name, voice, lang, kind, text, alt in clips:
        wav = render(out, name, voice, spoken.get(name, text))
        man.append({"name": name, "voice": voice, "lang": lang, "kind": kind, "text": text, "alt": alt, "wav": wav})
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(man, f, ensure_ascii=False, indent=1)
    print(f"{len(man)} clips in {out}")


if __name__ == "__main__":
    main()
