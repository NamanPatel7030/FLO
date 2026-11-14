// Fetch the small real Whisper model the mock model host serves to the app (any model Flo asks
// for gets this file), so dictation in the E2E run transcribes for real, fast. ~31 MB, cached.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(HERE, "..", ".cache", "model.bin");
const URL_ = process.env.FLO_E2E_MODEL_SRC ?? "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin";

if (fs.existsSync(out) && fs.statSync(out).size > 10_000_000) {
  console.log(`model fixture already at ${out}`);
  process.exit(0);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
const res = await fetch(URL_, { redirect: "follow" });
if (!res.ok) throw new Error(`download ${URL_}: ${res.status}`);
fs.writeFileSync(out + ".part", Buffer.from(await res.arrayBuffer()));
fs.renameSync(out + ".part", out);
console.log(`model fixture: ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
