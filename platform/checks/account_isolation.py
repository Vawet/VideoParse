"""Exercise account-bound videos, documents and per-device sign-out on a disposable platform."""
from io import BytesIO
from uuid import uuid4

import requests

from ownership import check


def accounts(base):
    base = base.rstrip('/')
    a,b,owner,other,video,filename,_ = check(base)
    name, password = "qa-" + uuid4().hex, uuid4().hex
    device = requests.Session()

    def call(browser, method, path, status=200, **kw):
        res=browser.request(method,base+path,timeout=20,**kw)
        assert res.status_code==status,(method,path,res.status_code)
        return res

    def enroll(browser,username):
        call(browser,"POST","/v2/account/register",json={"username":username,"password":password})

    def upload(browser, marker):
        return call(browser,"POST","/v2/documents",files={"file":(marker+".md",BytesIO(marker.encode()))}).json()["document"]["id"]

    doc=upload(a,"A-private")
    enroll(a,name)
    foreign=upload(b,"B-private")
    enroll(b,name+"-b")
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
    creds={"username":name,"password":password}
    call(device,"POST","/v2/account/login",401,json={**creds,"password":"incorrect-password"})
    call(device,"POST","/v2/account/login",json=creds)
    assert call(device,"GET","/v2/session").json()["workspace_id"]==owner
    assert call(device,"GET","/uploads/"+filename).content==b"private upload regression fixture"
    call(device,"GET","/v2/documents/"+doc)
    call(a,"POST","/v2/account/logout",json={})
    assert call(a,"GET","/v2/session").json()["workspace_id"] not in (owner,other)
    call(a,"GET","/uploads/"+filename,404)
    call(a,"GET","/v2/documents/"+doc,404)
    call(device,"GET","/v2/documents/"+doc)
    call(a,"POST","/v2/account/login",json={"username":name+"-b","password":password})
    call(a,"GET","/v2/documents/"+foreign)
    call(a,"GET","/v2/documents/"+doc,404)
    call(a,"GET","/uploads/"+filename,404)
    print("Guest adoption, separated accounts, private video/document APIs, new devices and account switching OK")


if __name__=="__main__":
    import sys
    accounts(sys.argv[1])
