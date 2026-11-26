"""Exercise private uploads and courses using two fresh accounts in a disposable platform instance."""
import argparse
from hashlib import sha256
import requests

from test_account import register


def check(base, credentials_a=None, credentials_b=None):
    base = base.rstrip("/")
    a, b = requests.Session(), requests.Session()

    def call(session, method, path, expected=200, **kwargs):
        response = session.request(method, base + path, timeout=15, **kwargs)
        assert response.status_code == expected, (method, path, response.status_code)
        return response

    def workspace(session):
        return call(session, "GET", "/v2/session").json()["workspace_id"]

    register(a, base, credentials_a)
    register(b, base, credentials_b)
    owner, other = workspace(a), workspace(b)
    assert owner != other and workspace(a) == owner
    payload = b"private upload regression fixture"
    manifest = {"filename": "fixture.mp4", "bytes": len(payload), "hashes": [sha256(payload).hexdigest()]}
    upload = call(a, "POST", "/v2/uploads", json=manifest).json()["id"]
    path = "/v2/uploads/" + upload
    call(b, "GET", path, 404)
    call(b, "PUT", path + "/0", 404, data=payload)
    call(a, "PUT", path + "/0", data=payload)
    assert call(a, "GET", path).json()["parts"] == [0]
    call(b, "POST", path + "/complete", 404)
    result = call(a, "POST", path + "/complete").json()
    video, filename = result["video_id"], result["filepath"]
    assert call(a, "GET", "/uploads/" + filename).content == payload
    call(b, "GET", "/uploads/" + filename, 404)
    call(b, "POST", "/analyze/start", 404, json={"filepath": filename})
    for endpoint in ["/result/" + video, "/frames/" + video, "/v2/videos/" + video + "/evidence?q=x"]:
        call(b, "GET", endpoint, 404)

    course = call(a, "POST", "/courses", json={"name": "Ownership check"}).json()["course"]["id"]
    call(a, "POST", "/courses/" + course + "/videos", json={"video_id": video})
    courses = call(b, "GET", "/courses").json()["courses"]
    assert all(c["id"] != course for c in courses)
    call(b, "GET", "/courses/" + course, 404)
    own_course = call(b, "POST", "/courses", json={"name": "Second workspace"}).json()["course"]["id"]
    call(b, "POST", "/courses/" + own_course + "/videos", 404, json={"video_id": video})
    call(b, "POST", "/chat", 404, json={"course_id": course, "question": "summary"})
    return a, b, owner, other, video, filename, course


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("api_base")
    check(parser.parse_args().api_base)
    print("两个账号的上传、视频和课程隔离验证通过")
