"""HTTP regression for the study worker's download reservation and bounded queue.

Run with a disposable MySQL/Redis configuration and the packaged platform JAR.
Only the Python provider runs as a fixture; client requests use real sessions.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time

import requests
from test_account import register


WORKER = """
import json, os, sys, time
from pathlib import Path
for line in sys.stdin:
    message = json.loads(line)
    operation = message['tool']
    download = operation == 'bilibili_import'
    if download or message['args']['params'].get('question') == 'hold':
        phase = 'download' if download else 'interactive'
        Path(f'{phase}-{os.getpid()}').touch()
        while not Path('release-'+phase).exists():
            time.sleep(.01)
    body = {'success':False,'error':'download fixture finished'} if download else {'success':True,'source':'local'}
    print('VP_RESULT '+json.dumps({'status':422 if download else 200,'body':body}),flush=True)
"""


def wait_for(predicate, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.02)
    raise AssertionError("Timed out waiting for the fixture state")


def run_load(base, work, baseline):
    accounts = []
    for _ in range(2):
        with requests.Session() as session:
            register(session, base)
            accounts.append(session.cookies.get_dict())

    def call(user, path, body):
        start = time.monotonic()
        r = requests.post(base + path, json=body, cookies=accounts[user], timeout=12)
        return r.status_code, round(1000*(time.monotonic()-start))

    def ask(user, question):
        return call(user, "/v2/demo/ask", {"question":question})

    with ThreadPoolExecutor(30) as pool:
        try:
            downloads = [pool.submit(call,0,"/v2/bilibili/import",{"url":"https://www.bilibili.com/video/BVfixture"}) for _ in range(2)]
            wait_for(lambda: len(list(work.glob("download-*"))) + sum(f.done() for f in downloads) == 2, 8)
            status, elapsed = ask(1,"short")
            (work/"release-download").touch()
            states = sorted(f.result()[0] for f in downloads)
            assert (states,status) == (([422,422],429) if baseline else ([422,429],200)), (states,status)

            busy = [pool.submit(ask,0,"hold") for _ in range(2)]
            wait_for(lambda: len(list(work.glob("interactive-*"))) == 2, 8)
            excess = [pool.submit(ask,1,"short") for _ in range(24)]
            replies = [f.result() for f in excess]
            assert all(r[0] == 429 for r in replies)
            (work/"release-interactive").touch()
            assert all(f.result()[0] == 200 for f in busy)
            assert ask(1,"recovered")[0] == 200
            times = sorted(r[1] for r in replies)
            fast = sum(t < 1000 for t in times)
            assert fast == (0 if baseline else 22), times
            print(f"interactive HTTP {status} in {elapsed} ms; {fast}/24 rejected within 1 s; "
                  f"excess p50={times[11]} ms, p95={times[22]} ms; worker permits recovered")
        finally:
            for phase in ("download","interactive"):
                (work/("release-"+phase)).touch()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jar",type=Path)
    parser.add_argument("--baseline",action="store_true",help="Check the previous unbounded-wait behavior")
    args = parser.parse_args()
    java = str(Path(os.environ["JAVA_HOME"])/"bin/java") if "JAVA_HOME" in os.environ else shutil.which("java")
    database = {k:os.environ[k] for k in ("JDBC_URL","DB_USER","DB_PASSWORD","REDIS_HOST","REDIS_PORT")}
    with tempfile.TemporaryDirectory(prefix="vp-admission-") as scratch:
        work = Path(scratch)
        (work/"app").mkdir()
        (work/"app"/"study_worker.py").write_text(WORKER,encoding="utf-8")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1",0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        env = dict(database,HOME=scratch,PATH=os.environ["PATH"],REDIS_PASSWORD=os.getenv("REDIS_PASSWORD",""),
                   MINIO_ENDPOINT="http://127.0.0.1:1",MINIO_ACCESS_KEY="fixture",MINIO_SECRET_KEY="fixture-local",
                   DATA_ROOT=str(work/"data"), WORKER_DIR=scratch, WORKER_PYTHON=sys.executable, PUBLIC_BASE_URL=base,
                   PLATFORM_PORT=str(port), PLATFORM_BIND="127.0.0.1", STUDY_WORKERS="2", UPLOAD_ANSWER="",
                   SESSION_COOKIE_SECURE="false", WORKER_POLL_MS="900000", PUBLISH_POLL_MS="900000")
        log = work/"platform.log"
        with log.open("wb") as output:
            app = subprocess.Popen([java,"-Xmx220m","-jar",str(args.jar.resolve())],env=env,cwd=scratch,stdout=output,stderr=subprocess.STDOUT)
        def ready():
            if app.poll() is not None:
                raise RuntimeError("Test instance exited during startup")
            try:
                return requests.get(base+"/health",timeout=1).ok
            except requests.ConnectionError:
                return False
        try:
            wait_for(ready,30)
            run_load(base,work,args.baseline)
        finally:
            app.terminate()
            try:
                app.wait(8)
            except subprocess.TimeoutExpired:
                app.kill()
                app.wait()


if __name__ == "__main__":
    main()
