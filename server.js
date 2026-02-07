import express from "express";
import multer from "multer";
import { spawn } from "child_process";

const app = express();

// RAM-only upload (no disk writes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 }, // 80MB
});

const YES_IMG =
  "https://raw.githubusercontent.com/msmason12/doesmysnaresuck/main/grumpy_yes.jpg";
const NO_IMG =
  "https://raw.githubusercontent.com/msmason12/doesmysnaresuck/main/grumpy_no.jpg";

// ---- Health
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ---- helper: run ffmpeg loudnorm on stdin, parse JSON
function analyzeLufs(buffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-i",
        "pipe:0",
        "-af",
        "loudnorm=print_format=json",
        "-f",
        "null",
        "-",
      ],
      { stdio: ["pipe", "ignore", "pipe"] }
    );

    let stderr = "";
    ff.stderr.on("data", (d) => (stderr += d.toString()));

    ff.on("error", (e) =>
      reject(new Error("Failed to start ffmpeg: " + (e?.message || e)))
    );

    ff.on("close", (code) => {
      const blocks = stderr.match(/\{[\s\S]*?\}/g);
      if (!blocks?.length) {
        return reject(
          new Error(`No loudnorm JSON found (ffmpeg code=${code})`)
        );
      }

      try {
        const data = JSON.parse(blocks[blocks.length - 1]);
        resolve({
          lufs: parseFloat(data.input_i),
          lra: parseFloat(data.input_lra),
          truePeak: parseFloat(data.input_tp),
          raw: data,
        });
      } catch (e) {
        reject(new Error("Failed to parse loudnorm JSON"));
      }
    });

    ff.stdin.end(buffer);
  });
}

// ---- API endpoint for n8n (keeps your old flow working)
app.post("/lufs", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const { lufs, lra, truePeak, raw } = await analyzeLufs(req.file.buffer);
    res.json({ lufs, lra, true_peak: truePeak, loudnorm: raw });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// ---- NEW: web UI upload page
app.get("/", (req, res) => {
  res.type("html").send(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Does My Snare Sound Like Sh*t?</title>
  <style>
    body { background:#0e0e11; color:#fff; font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; padding:32px; }
    .card { max-width:720px; margin:0 auto; background:#151518; border:1px solid #2a2a2f; border-radius:18px; padding:22px; }
    h1 { margin:0 0 10px; font-size:26px; }
    p { margin:0 0 16px; opacity:.8; }
    input { display:block; width:100%; margin:14px 0; }
    button { padding:12px 16px; border-radius:12px; border:1px solid #2a2a2f; background:#0f0f12; color:#fff; cursor:pointer; }
    .note { margin-top:10px; font-size:12px; opacity:.7; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Does my snare sound like sh*t?</h1>
    <p>Upload a WAV or MP3. Let's find out.</p>

    <form action="/analyze" method="post" enctype="multipart/form-data">
      <input type="file" name="file" accept=".wav,.mp3,audio/wav,audio/mpeg" required />
      <button type="submit">Analyze</button>
    </form>

    <div class="note">No files are stored. Audio is processed in-memory only.</div>
  </div>
</body>
</html>
  `);
});

// ---- NEW: web UI result page (same window)
app.post("/analyze", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).type("html").send("No file uploaded.");
    }

    const { lufs, lra, truePeak } = await analyzeLufs(req.file.buffer);

    // Your rule: under -14 LUFS => YES (sucks). Change if you want opposite.
    const isYes = lufs < -14;

    const verdictText = isYes ? "YES — UR SNARE SUCKS" : "NO — UR SNARE ROCKS";
    const img = isYes ? YES_IMG : NO_IMG;
    const accent = isYes ? "#ff4d4d" : "#4dff88";

    res.type("html").send(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Result</title>
  <style>
    body { background:#0e0e11; color:#fff; font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; padding:32px; }
    .card { max-width:720px; margin:0 auto; background:#151518; border:1px solid #2a2a2f; border-radius:18px; padding:22px; text-align:center; }
    .big { font-size:28px; font-weight:800; color:${accent}; margin:0 0 10px; }
    .stats { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin:14px 0 18px; }
    .pill { background:#0f0f12; border:1px solid #2a2a2f; border-radius:14px; padding:10px 12px; min-width:160px; }
    .label { font-size:12px; opacity:.7; margin-bottom:6px; }
    .value { font-size:18px; }
    img { width:220px; height:auto; border-radius:14px; display:block; margin:14px auto 0; }
    a { display:inline-block; margin-top:18px; padding:12px 16px; border-radius:12px; border:1px solid #2a2a2f; background:#0f0f12; color:#fff; text-decoration:none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="big">${verdictText}</div>

    <div class="stats">
      <div class="pill">
        <div class="label">Integrated LUFS</div>
        <div class="value">${Number(lufs).toFixed(2)}</div>
      </div>
      <div class="pill">
        <div class="label">LRA</div>
        <div class="value">${Number(lra).toFixed(2)}</div>
      </div>
      <div class="pill">
        <div class="label">True Peak (dBTP)</div>
        <div class="value">${Number(truePeak).toFixed(2)}</div>
      </div>
    </div>

    <img src="${img}" alt="verdict" />
    <a href="/">Analyze another</a>
  </div>
</body>
</html>
    `);
  } catch (e) {
    res.status(500).type("html").send(`
      <html><body style="font-family:system-ui;background:#111;color:#fff;padding:40px;">
        <h2>Analysis failed</h2>
        <pre style="white-space:pre-wrap;opacity:.8;">${String(e?.message || e)}</pre>
        <a href="/" style="color:#9dd1ff;">Try again</a>
      </body></html>
    `);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Listening on", port));
