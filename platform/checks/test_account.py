"""Create a fresh account in a disposable platform instance for HTTP checks."""
from uuid import uuid4


def register(session, base, credentials=None):
    credentials = credentials or {"username": "qa-" + uuid4().hex, "password": uuid4().hex}
    response = session.post(base.rstrip("/") + "/v2/account/register", json=credentials, timeout=10)
    response.raise_for_status()
    return credentials
