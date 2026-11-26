"""Run against disposable Spring/MySQL and a versioned MinIO bucket. See docs/concurrency-interview.md."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import os
from threading import Barrier
from urllib.parse import urlsplit
from uuid import UUID

from minio import Minio
import requests
from sqlalchemy import create_engine, text

from test_account import register


def run(args):
    endpoint = urlsplit(os.environ["MINIO_ENDPOINT"])
    objects = Minio(endpoint.netloc, access_key=os.environ["MINIO_ACCESS_KEY"],
                    secret_key=os.environ["MINIO_SECRET_KEY"], secure=endpoint.scheme == "https")
    bucket = os.environ["MINIO_BUCKET"]
    assert objects.get_bucket_versioning(bucket).status == "Enabled", "Use a disposable versioned bucket"
    db = create_engine(os.environ["UPLOAD_TEST_DATABASE_URL"])
    bases = [args.base.rstrip("/"), (args.peer or args.base).rstrip("/")]
    chunk = b"v" * (5 * 1024 * 1024)
    digest = sha256(chunk).hexdigest()
    copies = 12

    def put(base, upload, part, payload, cookies):
        return requests.put(f"{base}/v2/uploads/{upload}/{part}", data=payload, cookies=cookies, timeout=35)

    def versions(upload, part):
        key = f"parts/{upload}/{part}"
        return sum(1 for obj in objects.list_objects(bucket, prefix=key, include_version=True)
                   if obj.object_name == key and not obj.is_delete_marker)

    with requests.Session() as owner, requests.Session() as other:
        register(owner, bases[0])
        register(other, bases[0])
        cookies = owner.cookies.get_dict()

        def begin(parts):
            r = owner.post(bases[0] + "/v2/uploads", json={"filename": "retry.mp4", "bytes": len(chunk)*parts,
                           "hashes": [digest]*parts}, timeout=10)
            r.raise_for_status()
            return str(UUID(r.json()["id"]))

        def burst(upload, indices):
            start = Barrier(len(indices))

            def send(i, part):
                start.wait(timeout=10)
                put(bases[i % 2], upload, part, chunk, cookies).raise_for_status()

            with ThreadPoolExecutor(len(indices)) as pool:
                list(pool.map(send, range(len(indices)), indices))

        upload = begin(2)
        burst(upload, [0]*copies)
        writes = versions(upload, 0)
        assert writes == (copies if args.baseline else 1), writes
        print(f"{copies} identical 5 MiB PUTs: {writes} object versions, {writes*5} MiB logical writes")
        url = bases[0] + "/v2/uploads/" + upload
        assert owner.get(url, timeout=5).json()["parts"] == [0]
        assert owner.post(url + "/complete", timeout=5).status_code == 409
        assert put(bases[0], upload, 0, b"x"*len(chunk), cookies).status_code == 400
        assert put(bases[1], upload, 0, chunk, other.cookies.get_dict()).status_code == 404
        assert versions(upload, 0) == writes
        with db.begin() as conn:
            conn.execute(text("UPDATE vp_upload SET updated_at=NOW()-INTERVAL 1 DAY WHERE id=:id"), {"id": upload})
        put(bases[1], upload, 0, chunk, cookies).raise_for_status()
        with db.connect() as conn:
            assert conn.execute(text("SELECT updated_at > NOW()-INTERVAL 1 HOUR FROM vp_upload WHERE id=:id"),
                                {"id": upload}).scalar_one()
        control = begin(2)
        burst(control, [0, 1])
        assert [versions(control, i) for i in (0, 1)] == [1, 1]
        complete = bases[0] + "/v2/uploads/" + control + "/complete"
        result = owner.post(complete, timeout=30)
        result.raise_for_status()
        assert owner.post(complete, timeout=10).json()["video_id"] == result.json()["video_id"]
        put(bases[1], control, 0, chunk, cookies).raise_for_status()
        if not args.baseline:
            assert put(bases[1], control, 0, b"wrong", cookies).status_code == 400
        assert versions(control, 0) == 1

        # Fail between the real object PUT and the SQL receipt, for this upload alone.
        lost = begin(1)
        trigger = "retry_check_" + UUID(lost).hex
        with db.begin() as conn:
            conn.exec_driver_sql(f"""CREATE TRIGGER {trigger} BEFORE INSERT ON vp_part FOR EACH ROW
                BEGIN IF NEW.upload_id='{lost}' THEN SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT='injected receipt failure'; END IF; END""")
        try:
            assert put(bases[0], lost, 0, chunk, cookies).status_code == 500
            assert versions(lost, 0) == 1
            assert owner.get(bases[1] + "/v2/uploads/" + lost, timeout=5).json()["parts"] == []
        finally:
            with db.begin() as conn:
                conn.exec_driver_sql(f"DROP TRIGGER {trigger}")
        put(bases[1], lost, 0, chunk, cookies).raise_for_status()
        assert versions(lost, 0) == 2
        assert owner.get(bases[0] + "/v2/uploads/" + lost, timeout=5).json()["parts"] == [0]
        print("PASS separate parts, ownership, digest, expiry refresh, finish and retry after SQL rollback")
    db.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", help="Spring URL with no trailing /v2")
    parser.add_argument("--peer", help="second Spring instance sharing the same database and bucket")
    parser.add_argument("--baseline", action="store_true", help="expect one object version per replay")
    run(parser.parse_args())
