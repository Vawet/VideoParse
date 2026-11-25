"""Only reuse successful tools of the same immutable input and analysis job."""
import hashlib
import json
import os


REQUIRED = {
    "transcribe": ("transcript_raw", "transcript"),
    "correct_transcript": ("transcript",),
    "generate_summary": ("summary",),
    "generate_mindmap": ("mind_map",),
    "analyze_structure": ("division", "heavys"),
    "extract_keyframes": ("meta",),
    "write_frame_notes": ("segments",),
    "build_visual_transcript": ("transcript",),
    "read_frame_text": ("ocr",),
}


def key(ws, name, args):
    job = getattr(ws, "job_id", None)
    if not job or name not in REQUIRED:
        return None
    arg_hash = hashlib.sha256(json.dumps(args, sort_keys=True).encode()).hexdigest()[:16]
    return f"step_{job}_{name}_{arg_hash}"


def read(ws, name, stamp):
    entry = ws.load(stamp) if stamp else None
    if not isinstance(entry, dict) or not all(ws.has(a) for a in REQUIRED[name]):
        return None
    if name == "extract_keyframes":
        numbers = ws.meta.get("frame_numbers") or []
        if not numbers or not all(os.path.isfile(os.path.join(ws.frames_dir, f"{n}.png")) for n in numbers):
            return None
    return entry


def write(ws, stamp, observation):
    if stamp and not observation.get("error") and observation.get("ok", True) and not observation.get("failed"):
        ws.save(stamp, observation)
