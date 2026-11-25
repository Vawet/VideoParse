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


def run(base, target):
    backend = Path(__file__).resolve().parents[2] / "后端"
    with requests.Session() as session, TemporaryDirectory() as temp:
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
            for key in ("speech", "visual", "file", "empty"):
                db.execute("INSERT INTO videos VALUES(?,?,10,'analyzed')", (key, key))
                if key != "empty":
                    db.execute("INSERT INTO transcript_chunks VALUES(?,0,3,5,'archived caption')", (key,))
                (outputs / (key + "_result.json")).write_text(json.dumps({
                    "segments": [], "transcript_source": "visual" if key == "visual" else "speech"
                }))
        work = outputs / "file_work"
        work.mkdir()
        (work / "transcript.json").write_text(json.dumps({
            "source": "visual", "text": "archived original", "segments": [
                {"start_time": 6, "end_time": 7, "text": "archived original"}]}))
        for key in ("speech", "visual", "file", "empty"):
            video = uuid.uuid5(uuid.NAMESPACE_URL, f"videoparse/legacy/{owner}/{key}").hex
            def migrate():
                output = subprocess.check_output(
                    [sys.executable, "-m", "app.import_archived_video", "--workspace", owner,
                     "--source", str(source), "--", key], cwd=backend, text=True, timeout=15,
                    env={**os.environ, "DATABASE_URL": os.environ["PUBLICATION_TEST_DATABASE_URL"],
                         "DATA_ROOT": str(target)})
                return output.split()[1]
            job = migrate()
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
            assert migrate() == job
            response = session.get(f"{base}/v2/videos/{video}/evidence", params={"q": "archived"}, timeout=5)
            response.raise_for_status()
            hits = [(h["text"], h["source"], h["start"], h["end"]) for h in response.json()["hits"]]
            expected = {"empty": [], "speech": [("archived caption", "speech", 3, 5)],
                        "visual": [("archived caption", "frame_note", 3, 5)],
                        "file": [("archived original", "frame_note", 6, 7)]}
            assert hits == expected[key], (key, hits)
    print("PASS legacy transcript sources, timestamps and idempotent graph publication")


if __name__ == "__main__":
    run(sys.argv[1].rstrip("/"), Path(sys.argv[2]).resolve())
