"""Copy selected analyses from a local legacy workspace and publish them for one visitor."""
import argparse
from contextlib import closing
import filecmp
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import tempfile
from urllib.parse import urlsplit
import uuid

from sqlalchemy import create_engine, text
from app.publish_results import enqueue


def install(path, source=None, content=None):
    """A failed copy must never expose a partial file to a retry or reader."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        matches = filecmp.cmp(source, path, shallow=False) if source else path.read_bytes() == content
        if not matches:
            raise ValueError("目标文件与所选旧记录不同：" + path.name)
        return
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as out:
        tmp = Path(out.name)
    try:
        if source:
            shutil.copyfile(source, tmp)
        else:
            tmp.write_bytes(content)
        os.link(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def import_one(engine, source, target, owner, old_id):
    if not re.fullmatch(r"[0-9a-f]{32}", owner) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", old_id):
        raise ValueError("工作区或旧视频编号无效")
    video = uuid.uuid5(uuid.NAMESPACE_URL, f"videoparse/legacy/{owner}/{old_id}").hex
    with closing(sqlite3.connect((source / "data/videoparse.db").resolve().as_uri() + "?mode=ro", uri=True)) as old:
        info = old.execute("SELECT title,duration FROM videos WHERE id=? AND status='analyzed'", (old_id,)).fetchone()
        transcript = old.execute("SELECT idx,start_sec,end_sec,text FROM transcript_chunks WHERE video_id=? ORDER BY idx",
                                 (old_id,)).fetchall()
    raw = json.loads((source / "outputs" / (old_id + "_result.json")).read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not isinstance(raw.get("segments"), list):
        raise ValueError("旧解析结果格式不正确")
    for item in raw["segments"]:
        image = item.get("image")
        if image:
            path = urlsplit(image).path
            filename = path.rsplit("/", 1)[-1]
            if not path.endswith("/frames/" + old_id + "/" + filename) or not re.fullmatch(r"[a-zA-Z0-9_-]+\.png", filename):
                raise ValueError("解析结果中包含未知的图片路径")
            item["image"] = f"/api/frames/{video}/{filename}"
    if info is None:
        # Some legacy workspaces saved a complete result before registering the video in SQLite.
        if not isinstance(raw.get("division"), list) or not isinstance(raw.get("summary"), str):
            raise ValueError("旧库中缺少记录，且文件不含完整的解析结果")
        topic = raw.get("mind_map", {}).get("mind_map", {}).get("data", {}).get("name")
        info = (topic[:300] if isinstance(topic, str) and topic else old_id, 0)
    result = json.dumps(raw, ensure_ascii=False, separators=(",", ":")).encode()
    data = {"owner": owner, "video": video, "title": info[0] or old_id, "duration": info[1] or 0}
    with engine.begin() as db:
        if not db.execute(text("SELECT 1 FROM vp_visitor WHERE id=:owner AND expires_at>UTC_TIMESTAMP()"), data).first():
            raise ValueError("目标访客不存在或已过期，请重新从资料库复制命令")
        db.execute(text("""INSERT INTO videos(id,owner_id,title,duration,status,created_at)
            VALUES(:video,:owner,:title,:duration,'analyzed',UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE id=id"""), data)
        actual = db.execute(text("SELECT owner_id FROM videos WHERE id=:video FOR UPDATE"), data).scalar_one()
        if actual != owner:
            raise ValueError("视频编号归属冲突")
        completed = db.execute(text("SELECT job_id FROM vp_graph_head WHERE video_id=:video"), data).scalar()
        if completed:
            return completed
        active = db.execute(text("SELECT id FROM vp_job WHERE active_video=:video"), data).scalar()
        if active:
            return active
        # Install artifacts before the graph worker can see a publication job.
        for media in (source / "uploads").glob(old_id + ".*"):
            if media.suffix.lower() in {".mp4", ".mov", ".mkv", ".avi", ".webm", ".flv", ".m4v"} and not media.is_symlink():
                install(target / "uploads" / (video + media.suffix.lower()), source=media)
        for f in (source / "frames" / old_id).glob("*.png"):
            if re.fullmatch(r"[a-zA-Z0-9_-]+\.png", f.name) and not f.is_symlink():
                install(target / "frames" / video / f.name, source=f)
        work = source / "outputs" / (old_id + "_work")
        for f in work.glob("*.json"):
            if f.is_file() and not f.is_symlink():
                install(target / "outputs" / (video + "_work") / f.name, source=f)
        install(target / "outputs" / (video + "_result.json"), content=result)
        db.execute(text("DELETE FROM transcript_chunks WHERE video_id=:video"), data)
        if transcript:
            db.execute(text("""INSERT INTO transcript_chunks(video_id,idx,start_sec,end_sec,text)
                               VALUES(:video,:idx,:start,:end,:body)"""),
                       [dict(video=video, idx=i, start=a, end=b, body=t) for i, a, b, t in transcript])
        return enqueue(db, target, video)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("videos", nargs="+")
    args = parser.parse_args()
    engine = create_engine(os.environ["DATABASE_URL"], hide_parameters=True, isolation_level="READ COMMITTED")
    try:
        failures = 0
        for old_id in args.videos:
            try:
                job = import_one(engine, args.source, Path(os.environ["DATA_ROOT"]), args.workspace, old_id)
                print(old_id, job)
            except (ValueError, OSError, sqlite3.Error) as error:
                failures += 1
                print(f"{old_id} 迁移失败：{error}", file=sys.stderr)
        if failures:
            raise SystemExit(1)
    finally:
        engine.dispose()
