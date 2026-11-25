"""Queue a graph publication for an existing workspace result without running media tools."""
import argparse
import os
import re
import uuid
from pathlib import Path

from sqlalchemy import create_engine, text


def enqueue(db, root, video):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", video):
        raise ValueError("无效的视频编号")
    proposed = uuid.uuid4().hex
    db.execute(text("""
        INSERT INTO vp_job(id,video_id,active_video,status)
        VALUES (:id,:video,:video,'publishing') ON DUPLICATE KEY UPDATE id=id
    """), {"id": proposed, "video": video})
    job = db.execute(text("SELECT id FROM vp_job WHERE active_video=:video FOR UPDATE"),
                     {"video": video}).scalar_one()
    if job == proposed:
        if not (root / "outputs" / f"{video}_result.json").is_file():
            raise ValueError(f"{video} 缺少解析结果文件")
        db.execute(text("INSERT INTO vp_dispatch(job_id,stage) VALUES (:job,'graph')"), {"job": job})
    return job


def publish(engine, root, video):
    with engine.begin() as db:
        return enqueue(db, root, video)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("videos", nargs="+", metavar="VIDEO_ID")
    args = parser.parse_args()
    engine = create_engine(os.environ["DATABASE_URL"], hide_parameters=True)
    try:
        for video in args.videos:
            print(video, publish(engine, Path(os.environ["DATA_ROOT"]), video))
    finally:
        engine.dispose()
