"""Exercise account-bound videos, documents and per-device sign-out on a disposable platform."""
from io import BytesIO
from uuid import uuid4

import requests

from ownership import check


def accounts(base):
    base = base.rstrip('/')
    name, password = "qa-" + uuid4().hex, uuid4().hex
    device = requests.Session()

    def call(browser, method, path, status=200, **kw):
        res=browser.request(method,base+path,timeout=20,**kw)
        assert res.status_code==status,(method,path,res.status_code)
        return res

    guest = requests.Session()
    status = call(guest, "GET", "/v2/session")
    assert status.json()["workspace_id"] == "" and not guest.cookies
    for method, path in [("GET", "/v2/library"), ("GET", "/courses"), ("POST", "/upload"),
                         ("POST", "/v2/uploads"), ("POST", "/v2/documents"), ("POST", "/v2/demo/ask"),
                         ("POST", "/v2/documents/chat"), ("POST", "/v2/bilibili/import")]:
        call(guest, method, path, 401)

    creds = {"username": name, "password": password}
    a,b,owner,other,video,filename,_ = check(base, creds, {**creds, "username": name+"-b"})

    def upload(browser, marker):
        return call(browser,"POST","/v2/documents",files={"file":(marker+".md",BytesIO(marker.encode()))}).json()["document"]["id"]

    doc=upload(a,"A-private")
    foreign=upload(b,"B-private")
    assert call(a,"GET","/v2/session").json()["workspace_id"]==owner
    assert call(b,"GET","/v2/session").json()["workspace_id"]==other
    for browser, own, hidden in ((a,doc,foreign),(b,foreign,doc)):
        listed={x["id"] for x in call(browser,"GET","/v2/library").json()["documents"]}
        assert own in listed and hidden not in listed
        call(browser,"GET","/v2/documents/"+own)
        call(browser,"GET","/v2/documents/"+hidden,404)
    call(b,"GET","/uploads/"+filename,404)
    call(b,"GET","/result/"+video,404)
    call(b,"GET","/v2/library/videos/"+video,404)
    call(device,"POST","/v2/account/login",401,json={**creds,"password":"incorrect-password"})
    call(device,"POST","/v2/account/login",json=creds)
    assert call(device,"GET","/v2/session").json()["workspace_id"]==owner
    assert call(device,"GET","/uploads/"+filename).content==b"private upload regression fixture"
    call(device,"GET","/v2/documents/"+doc)
    call(a,"POST","/v2/account/logout",json={})
    assert call(a,"GET","/v2/session").json()["workspace_id"] not in (owner,other)
    call(a,"GET","/uploads/"+filename,401)
    call(a,"GET","/v2/documents/"+doc,401)
    call(device,"GET","/v2/documents/"+doc)
    call(a,"POST","/v2/account/login",json={"username":name+"-b","password":password})
    call(a,"GET","/v2/documents/"+foreign)
    call(a,"GET","/v2/documents/"+doc,404)
    call(a,"GET","/uploads/"+filename,404)
    print("Guest access gate, separated accounts, private video/document APIs, new devices and account switching OK")


if __name__=="__main__":
    import sys
    accounts(sys.argv[1])
