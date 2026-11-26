"""Mixed library checks for an isolated platform with a disposable DB, data volume and offline or stubbed answer worker."""
import json
import os
from pathlib import Path
import sys
import time
import uuid

import requests
from sqlalchemy import create_engine, text
from test_account import register


def run(base, data_root):
    db = create_engine(os.environ["LIBRARY_TEST_DATABASE_URL"])
    api = base.rstrip("/") + "/v2"
    owner, other = requests.Session(), requests.Session()
    for session in (owner, other):
        register(session, base)
    owner_id, other_id = [s.get(api + "/session", timeout=5).json()["workspace_id"] for s in (owner, other)]
    outputs = data_root / "outputs"
    outputs.mkdir(parents=True, exist_ok=True)
    speech = "恒温实验要求对照组使用相同温度。"
    ocr = "恒温实验的仪表读数为二十五度。"
    note = "恒温实验需要记录三次独立测量。"

    def add_video(who, title, summary, subtitle=None, screen=None, **artifacts):
        video = uuid.uuid4().hex
        (outputs / (video + "_result.json")).write_text(json.dumps({"summary": summary, **artifacts}))
        if subtitle or screen:
            work = outputs / (video + "_work")
            work.mkdir()
            if subtitle:
                (work / "transcript.json").write_text(json.dumps({"segments": [
                    {"start_time": 12.5, "end_time": 18, "text": subtitle}]}))
            if screen:
                (work / "ocr.json").write_text(json.dumps([{"start": 24, "frame": "frame_0025.png", "text": screen}]))
        with db.begin() as conn:
            conn.execute(text("""INSERT INTO videos(id,owner_id,title,duration,status,created_at,folder_id)
                VALUES(:v,:o,:t,45,'analyzed',UTC_TIMESTAMP(),'videos')"""), {"v":video,"o":who,"t":title})
        return video

    def indexed(session, video, expected):
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            rows = session.get(api + "/library", timeout=5).json()["videos"]
            state = next(row["indexState"] for row in rows if row["id"] == video)
            if state == expected:
                return
            assert state != "error", (video, state)
            time.sleep(.2)
        raise AssertionError((video, expected, state))

    def ask(kind="all", item=None, question="恒温实验", session=owner, **extra):
        response = session.post(api + "/library/chat", json=dict(question=question, kind=kind, sourceId=item,
                                libraryOnly=True, **extra), timeout=20)
        response.raise_for_status()
        events = [json.loads(line) for line in response.iter_lines() if line]
        assert events[-1]["type"] == "answer", events[-1]
        return events[-1]["data"]

    video = add_video(owner_id, "实验示范", "AI 汇总实验流程。", speech, ocr,
                      division=[{"title":"实验操作","summary":"polarization","time_range":{"start_time":"12","end_time":"18"}}])
    legacy = add_video(owner_id, "旧解析", "仅摘要保存了光谱校准方法。")
    hidden = add_video(other_id, "另一工作区", "恒温实验私有资料。", "恒温实验私有结论。")
    captions = add_video(owner_id, "旧版片段", "", segments=[{"time_range":"00:03 - 00:04","captions":"光谱波长为六百纳米。"}])
    indexed(owner, captions, "ready")
    assert ask("video", captions, "光谱波长")["hits"][0]["start"] == 3
    indexed(owner, video, "ready")
    assert {h["body"] for h in ask("video", video, "polarization")["hits"]} == {speech}
    indexed(owner, legacy, "derived")
    indexed(other, hidden, "ready")
    upload = owner.post(api + "/documents", files={"file":("实验.md", ("# 实验\n"+note).encode())}, timeout=8)
    upload.raise_for_status()
    doc = upload.json()["document"]["id"]
    result = ask()
    assert {h["body"] for h in result["hits"]} >= {speech, ocr, "# 实验\n"+note}, result
    assert all(h["videoId"] != hidden for h in result["hits"])
    assert all(c["quote"] in result["hits"][c["id"]-1]["body"] for c in result["claims"])
    if not result["claims"]:
        assert "原文" in result["answer"]
    assert {h["videoId"] for h in ask("video")["hits"]} == {video}
    assert {h["docId"] for h in ask("document")["hits"]} == {doc}
    baseline = owner.post(api+"/documents/chat",json={"question":"恒温实验","documentsOnly":True},timeout=20)
    baseline.raise_for_status()
    old_answer = json.loads(list(baseline.iter_lines())[-1])["data"]
    assert {h["docId"] for h in old_answer["hits"]} == {doc}
    assert ask("video", legacy, "概括这个视频")["hits"][0]["start"] is None
    assert next(h for h in result["hits"] if h["origin"] == "ocr")["frame"] == "frame_0025.png"
    denied = owner.post(api + "/library/chat", json={"question":"恒温实验","kind":"video","sourceId":hidden}, timeout=5)
    assert denied.status_code == 404
    wrong_scope = owner.post(api + "/library/chat", json={"question":"继续","kind":"document","libraryOnly":True,
                                 "conversationId":result["conversation_id"]}, timeout=5)
    assert wrong_scope.status_code == 404

    def path(hit):
        return api + "/library/videos/" + hit["videoId"] + "/passages/" + hit["passageKey"]

    by_origin = {h["origin"]:h for h in result["hits"]}
    for origin, at in [("speech", 12.5), ("ocr", 24)]:
        hit = by_origin[origin]
        ref = owner.get(path(hit), timeout=5).json()
        assert ref["hit"]["start"] == at and ref["filepath"] == ""
        assert other.get(path(hit), timeout=5).status_code == 404
        assert owner.post(path(hit)+"/review", json={"question":"恒温实验","quote":"虚构引文"}, timeout=5).status_code == 409
        for _ in range(2):
            owner.post(path(hit)+"/review", json={"question":"恒温实验","quote":hit["body"]}, timeout=5).raise_for_status()
    owner.post(api + f"/documents/{doc}/chunks/0/review", json={"question":"记录什么？","quote":note}, timeout=5).raise_for_status()
    queue = api + "/library/review"
    card = owner.get(queue, timeout=5).json()["next"]
    assert card["total"] == card["dueCount"] == 3
    doc_card = owner.get(api+"/documents/review", timeout=5).json()["next"]
    assert (doc_card["total"], doc_card["firstLine"], doc_card["lastLine"]) == (1, 2, 2)
    assert other.get(queue, timeout=5).json()["next"] is None
    rate = owner.post(queue + "/" + card["id"] + "/rate", json={"revision":card["revision"],"rating":"remembered"},timeout=5)
    rate.raise_for_status()
    assert owner.get(queue,timeout=5).json()["next"]["dueCount"] == 2

    # Rebuild with a different first sentence. An ordinal would silently redirect this citation.
    work = outputs / (video + "_work")
    (work / "transcript.json").write_text(json.dumps({"segments":[{"start_time":12.5,"end_time":18,"text":"修订的实验条件。"}]}))
    with db.begin() as conn:
        conn.execute(text("""UPDATE videos SET library_generation=library_generation+1,library_state='pending',
                    library_after=CURRENT_TIMESTAMP(3) WHERE id=:v"""), {"v":video})
    indexed(owner, video, "ready")
    assert owner.get(path(by_origin["speech"]), timeout=5).status_code == 404
    assert owner.get(path(by_origin["ocr"]), timeout=5).status_code == 200
    owner.delete(api + "/library/videos/" + video, timeout=5).raise_for_status()
    assert owner.get(path(by_origin["ocr"]), timeout=5).status_code == 404
    assert all(h["videoId"] != video for h in ask()["hits"])
    assert owner.get(queue,timeout=5).json()["next"]["total"] == 1
    print("PASS mixed evidence, scoped history, private citations, archived summaries, recall, reindex and removal")


if __name__ == "__main__":
    run(sys.argv[1], Path(sys.argv[2]))
