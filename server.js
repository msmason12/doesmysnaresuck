import express from "express";
import multer from "multer";
import { spawn } from "child_process";

const app = express();

// Memory-only upload (RAM). No file storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 }, // 80MB cap
});

app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/lufs", upload.single("file"), (req, res) => {
  if (!req.file?.buffer) {
    return res.status(400).json({ error: "No file uploaded. Use form-data field name: file" });
  }

  const ff = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i", "pipe:0",
      "-af", "loudnorm=print_format=json",
      "-f", "null",
      "-"
    ],
    { stdio: ["pipe", "ignore", "pipe"] }
  );

  let stderr = "";
  ff.stderr.on("data", (d) => (stderr += d.toString()));

  ff.on("error", (e) => {
    return res.status(500).json({ error: "Failed to start ffmpeg", details: String(e.message || e) });
  });

  ff.on("close", (code) => {
    const blocks = stderr.match(/\{[\s\S]*?\}/g);
    if (!blocks?.length) {
      return res.status(500).json({
        error: "No loudnorm JSON found",
        ffmpeg_exit_code: code,
        stderr_tail: stderr.slice(-2000),
      });
    }

    let data;
    try {
      data = JSON.parse(blocks[blocks.length - 1]);
    } catch {
      return res.status(500).json({ error: "Could not parse loudnorm JSON", stderr_tail: stderr.slice(-2000) });
    }

    return res.json({
      lufs: parseFloat(data.input_i),
      lra: parseFloat(data.input_lra),
      true_peak: parseFloat(data.input_tp),
    });
  });

  ff.stdin.end(req.file.buffer);
});

// Render sets PORT; default to 3000 locally
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`LUFS service listening on ${port}`));
