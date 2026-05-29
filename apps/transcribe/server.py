#!/usr/bin/env python3
"""
Whisper HTTP transcription microservice.
Runs as a standalone HTTP server that the API calls when
TRANSCRIPTION_PROVIDER=whisper-http and WHISPER_HTTP_URL=http://transcribe:8765.

POST /transcribe  multipart/form-data  audio=<binary>
GET  /health      → {"status":"ok"}

Environment variables:
  WHISPER_MODEL           tiny|base|small|medium|large-v2|large-v3  (default: base)
  WHISPER_DEVICE          cpu|cuda|auto  (default: cpu)
  WHISPER_COMPUTE_TYPE    int8|float16|float32  (default: int8)
  WHISPER_LANGUAGE        en|es|...  (optional, auto-detect if unset)
  WHISPER_PORT            HTTP listen port  (default: 8765)
  HF_TOKEN                HuggingFace token for speaker diarization  (optional)
"""
import cgi
import json
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

WHISPER_MODEL  = os.environ.get("WHISPER_MODEL", "base")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE   = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
LANGUAGE       = os.environ.get("WHISPER_LANGUAGE") or None
HF_TOKEN       = os.environ.get("HF_TOKEN", "")
PORT           = int(os.environ.get("WHISPER_PORT", 8765))

print(f"[whisper] Loading model '{WHISPER_MODEL}' on {WHISPER_DEVICE}…", file=sys.stderr, flush=True)

from faster_whisper import WhisperModel
model = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=COMPUTE_TYPE)
print("[whisper] Model loaded.", file=sys.stderr, flush=True)

diarizer = None
if HF_TOKEN:
    try:
        from pyannote.audio import Pipeline
        diarizer = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1", use_auth_token=HF_TOKEN
        )
        print("[whisper] Speaker diarization pipeline loaded.", file=sys.stderr, flush=True)
    except Exception as e:
        print(f"[whisper] Diarization unavailable: {e}", file=sys.stderr, flush=True)
else:
    print("[whisper] No HF_TOKEN — speaker diarization disabled.", file=sys.stderr, flush=True)


def transcribe(path, language=None):
    lang = language or LANGUAGE  # per-request overrides env default
    segs_gen, _ = model.transcribe(
        path, beam_size=5, word_timestamps=True, language=lang
    )
    segments = [
        {"speaker": "Speaker 1", "start": s.start, "end": s.end, "text": s.text.strip()}
        for s in segs_gen
    ]

    if diarizer:
        try:
            diarization = diarizer(path)
            turns = [
                (t.start, t.end, f"Speaker {int(l.split('_')[1]) + 1}")
                for t, _, l in diarization.itertracks(yield_label=True)
            ]

            def get_speaker(start, end):
                mid = (start + end) / 2
                for s, e, sp in turns:
                    if s <= mid <= e:
                        return sp
                best, bd = "Speaker 1", float("inf")
                for s, e, sp in turns:
                    d = abs(mid - (s + e) / 2)
                    if d < bd:
                        bd, best = d, sp
                return best

            for seg in segments:
                seg["speaker"] = get_speaker(seg["start"], seg["end"])

            merged = []
            for seg in segments:
                if (merged
                        and merged[-1]["speaker"] == seg["speaker"]
                        and seg["start"] - merged[-1]["end"] < 1.5):
                    merged[-1]["end"] = seg["end"]
                    merged[-1]["text"] += " " + seg["text"]
                else:
                    merged.append(dict(seg))
            segments = merged
        except Exception as e:
            print(f"[whisper] Diarization run failed: {e}", file=sys.stderr, flush=True)

    speakers = set(s["speaker"] for s in segments)
    if len(speakers) > 1:
        transcript = "\n".join(f"{s['speaker']}: {s['text']}" for s in segments)
    else:
        transcript = " ".join(s["text"] for s in segments)

    return {
        "status": "completed",
        "transcript": transcript,
        "segments": segments,
        "speakerCount": len(speakers),
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # silence default access log

    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(data))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"status": "ok", "model": WHISPER_MODEL})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/transcribe":
            self._send(404, {"error": "not found"})
            return
        try:
            ctype, pdict = cgi.parse_header(self.headers.get("Content-Type", ""))
            if ctype != "multipart/form-data":
                self._send(400, {"error": "expected multipart/form-data"})
                return
            pdict["boundary"] = bytes(pdict.get("boundary", ""), "utf-8")
            pdict["CONTENT-LENGTH"] = int(self.headers.get("Content-Length", 0))
            fields = cgi.parse_multipart(self.rfile, pdict)

            audio = fields.get("audio", [None])[0]
            if audio is None:
                self._send(400, {"error": "missing audio field"})
                return

            ext = fields.get("ext", [".webm"])[0]
            lang_field = fields.get("language", [None])[0]
            req_language = lang_field.strip() if lang_field else None

            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
                f.write(audio)
                tmp = f.name

            result = transcribe(tmp, language=req_language)
            os.unlink(tmp)
            self._send(200, result)
        except Exception as e:
            self._send(500, {"error": str(e)})


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[whisper] Listening on :{PORT}", file=sys.stderr, flush=True)
    server.serve_forever()
