#!/usr/bin/env python3
"""
faster-whisper transcription subprocess.
Usage: python3 transcribe.py <audio_file_path>
Prints JSON to stdout. Reads config from env vars.

WHISPER_MODEL      model size: tiny / base / small / medium / large-v2 / large-v3 (default: base)
WHISPER_DEVICE     cpu / cuda / auto (default: cpu)
WHISPER_COMPUTE_TYPE  int8 / float16 / float32 (default: int8)
WHISPER_LANGUAGE   ISO 639-1 code, e.g. en / es (default: auto-detect)
HF_TOKEN           HuggingFace token — enables speaker diarization via pyannote
KMP_DUPLICATE_LIB_OK=TRUE  set automatically, suppresses macOS OpenMP warning
"""
import json
import os
import sys

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

WHISPER_MODEL    = os.environ.get("WHISPER_MODEL", "base")
WHISPER_DEVICE   = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE     = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
LANGUAGE         = os.environ.get("WHISPER_LANGUAGE") or None
HF_TOKEN         = os.environ.get("HF_TOKEN", "")


def main():
    if len(sys.argv) < 2:
        _fail("No audio file path provided")

    audio_path = sys.argv[1]

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        _fail("faster-whisper is not installed. Run: pip install faster-whisper")

    try:
        model = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=COMPUTE_TYPE)
        segments_gen, _info = model.transcribe(
            audio_path,
            beam_size=5,
            word_timestamps=True,
            language=LANGUAGE,
        )
        segments = [
            {"speaker": "Speaker 1", "start": s.start, "end": s.end, "text": s.text.strip()}
            for s in segments_gen
        ]
    except Exception as e:
        _fail(f"Transcription failed: {e}")

    # Optional: speaker diarization via pyannote
    if HF_TOKEN:
        segments = _diarize(audio_path, segments)

    speakers = sorted({s["speaker"] for s in segments})
    if len(speakers) > 1:
        transcript = "\n".join(f"{s['speaker']}: {s['text']}" for s in segments)
    else:
        transcript = " ".join(s["text"] for s in segments)

    print(json.dumps({
        "status": "completed",
        "transcript": transcript,
        "segments": segments,
        "speakerCount": len(speakers),
    }))


def _diarize(audio_path, segments):
    try:
        from pyannote.audio import Pipeline
    except ImportError:
        return segments  # pyannote not installed, skip

    try:
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=HF_TOKEN,
        )
        diarization = pipeline(audio_path)
        turns = [
            (turn.start, turn.end, f"Speaker {int(label.split('_')[1]) + 1}")
            for turn, _, label in diarization.itertracks(yield_label=True)
        ]
    except Exception as e:
        print(f"[whisper] Diarization failed: {e}", file=sys.stderr)
        return segments

    def get_speaker(start, end):
        mid = (start + end) / 2
        for s, e, sp in turns:
            if s <= mid <= e:
                return sp
        # fallback: nearest turn midpoint
        best, best_dist = "Speaker 1", float("inf")
        for s, e, sp in turns:
            d = abs(mid - (s + e) / 2)
            if d < best_dist:
                best_dist, best = d, sp
        return best

    for seg in segments:
        seg["speaker"] = get_speaker(seg["start"], seg["end"])

    # Merge consecutive same-speaker short segments
    merged = []
    for seg in segments:
        if (merged
                and merged[-1]["speaker"] == seg["speaker"]
                and seg["start"] - merged[-1]["end"] < 1.5):
            merged[-1]["end"] = seg["end"]
            merged[-1]["text"] += " " + seg["text"]
        else:
            merged.append(dict(seg))
    return merged


def _fail(msg):
    print(json.dumps({"status": "failed", "error": msg,
                      "transcript": "", "segments": [], "speakerCount": 0}))
    sys.exit(1)


if __name__ == "__main__":
    main()
