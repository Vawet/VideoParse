"""Import legacy subtitle layouts into a disposable platform and search the published evidence."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
import uuid

import requests

from test_account import register


def run(base, target):
    backend = Path(__file__).resolve().parents[2] / "后端"
    worker_env = {**os.environ, "DATABASE_URL": os.environ["PUBLICATION_TEST_DATABASE_URL"],
                  "DATA_ROOT": str(target), "PYTHON_DOTENV_DISABLED": "1"}
    expected = {
        "empty": [],
        "speech": [("archived caption", "speech", 3, 5)],
        "visual": [("archived caption", "frame_note", 3, 5)],
        "file": [("archived original", "frame_note", 6, 7)],
        "file_only": [("archived original", "frame_note", 6, 7)],
    }
    with requests.Session() as session, TemporaryDirectory() as temp:
        register(session, base)
        response = session.get(base + "/v2/session", timeout=5)
        response.raise_for_status()
        owner = response.json()["workspace_id"]
        source = Path(temp)
        (source / "data").mkdir()
        outputs = source / "outputs"
        outputs.mkdir()
        with sqlite3.connect(source / "data/videoparse.db") as db:
            db.execute("CREATE TABLE videos(id TEXT, title TEXT, duration REAL, status TEXT)")
            db.execute("CREATE TABLE transcript_chunks(video_id TEXT, idx INTEGER, start_sec REAL, end_sec REAL, text TEXT)")
            for key in expected:
                if key != "file_only":
                    db.execute("INSERT INTO videos VALUES(?,?,10,'analyzed')", (key, key))
                if key in {"speech", "visual", "file"}:
                    db.execute("INSERT INTO transcript_chunks VALUES(?,0,3,5,'archived caption')", (key,))
                (outputs / (key + "_result.json")).write_text(json.dumps({
                    "segments": [], "summary": "archive", "division": [],
                    "transcript_source": "visual" if key == "visual" else "speech"
                }))
        for key in ("file", "file_only"):
            work = outputs / (key + "_work")
            work.mkdir()
            (work / "transcript.json").write_text(json.dumps({
                "source": "visual", "text": "archived original", "segments": [
                    {"start_time": 6, "end_time": 7, "text": "archived original"}]}))
        def migrate(key):
            output = subprocess.check_output(
                [sys.executable, "-m", "app.import_archived_video", "--workspace", owner,
                 "--source", str(source), "--", key], cwd=backend, text=True, timeout=15, env=worker_env,
                stderr=subprocess.PIPE)
            return output.split()[1]

        # A corrected archive must be importable after a bad timestamp is rejected.
        file_only = outputs / "file_only_work/transcript.json"
        original = file_only.read_bytes()
        file_only.write_text(json.dumps({"segments": [{"start_time": 2, "end_time": 1, "text": "bad"}]}))
        try:
            migrate("file_only")
        except subprocess.CalledProcessError as err:
            assert "时间戳无效" in err.stderr, err.stderr
        else:
            raise AssertionError("invalid timestamp accepted")
        file_only.write_bytes(original)

        for key in expected:
            video = uuid.uuid5(uuid.NAMESPACE_URL, f"videoparse/legacy/{owner}/{key}").hex
            job = migrate(key)
            deadline = time.monotonic() + 15
            while True:
                response = session.get(base + "/tasks/" + job, timeout=5)
                response.raise_for_status()
                status = response.json()["status"]
                if status != "publishing":
                    break
                assert time.monotonic() < deadline, status
                time.sleep(0.1)
            assert status == "done", status
            assert migrate(key) == job
            response = session.get(f"{base}/v2/videos/{video}/evidence", params={"q": "archived"}, timeout=5)
            response.raise_for_status()
            hits = [(h["text"], h["source"], h["start"], h["end"]) for h in response.json()["hits"]]
            assert hits == expected[key], (key, hits)
            if key == "file_only":
                response = session.post(f"{base}/v2/videos/{video}/course", timeout=5)
                response.raise_for_status()
                course = response.json()["course_id"]
                lookup = ("import json,sys; from app.db.repo import get_transcript; "
                          "print(json.dumps(get_transcript(sys.argv[1], course_id=sys.argv[2])))")
                transcript = json.loads(subprocess.check_output([sys.executable, "-c", lookup, video, course],
                                        cwd=backend, env=worker_env, text=True, timeout=10))
                assert transcript == [{"start_time": 6, "end_time": 7, "text": "archived original"}], transcript
    print("PASS legacy transcript search, course citations and idempotent publication")


if __name__ == "__main__":
    run(sys.argv[1].rstrip("/"), Path(sys.argv[2]).resolve())
