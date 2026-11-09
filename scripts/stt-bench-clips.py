#!/usr/bin/env python3
"""Make the on-device speech benchmark clips (macOS `say`, 16 kHz mono WAV) and a manifest.

    python3 scripts/stt-bench-clips.py /tmp/flo-stt-clips
    cd src-tauri && FLO_BENCH_MANIFEST=/tmp/flo-stt-clips/manifest.json \
      FLO_BENCH_MODEL="$HOME/Library/Application Support/com.flo.flow/models/ggml-large-v3-turbo-q5_0.bin" \
      FLO_BENCH_OUT=/tmp/stt-bench.json cargo test --release --lib stt_bench -- --ignored --nocapture

English uses the Samantha / Rishi / Aman / Tara voices, Hindi the Lekha voice. macOS has no
Gujarati voice, so the Gujarati clips are Gujarati sentences read by Lekha from a Devanagari
transliteration: Hindi-accented Gujarati, a harder test than a native speaker.
"""
import json, os, subprocess, sys

clips = [
 ("en_short1", "Samantha", "en", "Yes."),
 ("en_short2", "Rishi", "en", "Okay, send it."),
 ("en_s1", "Samantha", "en", "Send the deck to Rahul by Friday."),
 ("en_s2", "Rishi", "en", "Can you draft a message to the team wishing everyone a happy Dhanteras?"),
 ("en_s3", "Aman", "en", "Remind me to call the bank tomorrow at eleven."),
 ("en_s4", "Tara", "en", "Okay, mark the invoice task as done and open Slack."),
 ("en_s5", "Rishi", "en", "I think the new build is really fast and the notch looks great."),
 ("en_s6", "Samantha", "en", "Please review the pull request before lunch and leave comments on the authentication changes."),
 ("en_long", "Rishi", "en", "So here is the plan for this week. On Monday we finish the onboarding screens, on Tuesday we test the speech model with Hindi and Gujarati speakers, and on Wednesday we ship the beta to the first fifty users. After that we collect feedback, fix the top three bugs, and prepare the launch post for Friday."),
 ("en_long2", "Samantha", "en", "Hey team, quick update on the release. The dictation latency is down to about half a second, memory use dropped a lot after switching to the quantized model, and the new dashboard is almost ready. Let me know if you see anything weird before Thursday."),
 ("hi_s1", "Lekha", "hi", "कल सुबह दस बजे मीटिंग है, सबको याद दिला देना।"),
 ("hi_s2", "Lekha", "hi", "मुझे राहुल को इनवॉइस भेजना है।"),
 ("hi_s3", "Lekha", "hi", "आज का काम पूरा हो गया, अब घर जा रहा हूँ।"),
 ("hi_s4", "Lekha", "hi", "क्या तुम शाम को बाज़ार से दूध और सब्ज़ी ले आओगे?"),
 ("hi_s5", "Lekha", "hi", "हाँ।"),
 ("hi_long", "Lekha", "hi", "इस हफ्ते हमें तीन काम पूरे करने हैं। पहला, नया डिज़ाइन फाइनल करना है। दूसरा, ग्राहकों से फीडबैक लेना है। और तीसरा, शुक्रवार तक रिपोर्ट भेजनी है ताकि सोमवार को लॉन्च हो सके।"),
]

gu = [
 ("gu_s1", "કાલે સવારે દસ વાગ્યે મીટિંગ છે."),
 ("gu_s2", "મારે રાહુલને ઇન્વોઇસ મોકલવાનું છે."),
 ("gu_s3", "આજનું કામ પૂરું થઈ ગયું, હવે હું ઘરે જાઉં છું."),
 ("gu_s4", "તમે સાંજે બજારમાંથી દૂધ અને શાકભાજી લાવશો?"),
]


# Hinglish: code-mixed speech (Lekha reads it in Devanagari); expected text in Roman letters, the
# way people type it. Scored in "fixed" mode with Flo's "hi-en" language.
hinglish = [
 ("hien_s1", "कल की मीटिंग कैंसल कर दो, क्लाइंट ने रीशेड्यूल किया है।", "Kal ki meeting cancel kar do, client ne reschedule kiya hai."),
 ("hien_s2", "मैं पांच मिनट में कॉल करता हूँ, तुम डेक रेडी रखो।", "Main paanch minute mein call karta hoon, tum deck ready rakho."),
]


def to_deva(s):
    # Gujarati and Devanagari share the ISCII layout: same offset within their Unicode blocks
    return "".join(chr(ord(c) - 0x0A80 + 0x0900) if 0x0A80 <= ord(c) <= 0x0AFF else c for c in s)


def render(out, name, voice, text):
    aiff, wav = os.path.join(out, name + ".aiff"), os.path.join(out, name + ".wav")
    subprocess.run(["say", "-v", voice, "-o", aiff, text], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav], check=True)
    os.remove(aiff)
    return wav


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/flo-stt-clips"
    os.makedirs(out, exist_ok=True)
    man = []
    for name, voice, lang, text in clips:
        man.append({"name": name, "voice": voice, "lang": lang, "text": text, "wav": render(out, name, voice, text)})
    for name, text in gu:
        wav = render(out, name, "Lekha", to_deva(text))
        man.append({"name": name, "voice": "Lekha (Gujarati via Devanagari)", "lang": "gu", "text": text, "wav": wav})
    for name, spoken, text in hinglish:
        wav = render(out, name, "Lekha", spoken)
        man.append({"name": name, "voice": "Lekha", "lang": "hi-en", "text": text, "wav": wav})
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(man, f, ensure_ascii=False, indent=1)
    print(f"{len(man)} clips in {out}")


if __name__ == "__main__":
    main()
