from io import BytesIO
from unittest.mock import patch

import pytest
from app.services import bilibili


def test_page_and_media_sources_are_scoped():
    assert bilibili.identify("https://m.bilibili.com/video/av123?p=2") == ("av123", 2)
    for url in ["https://example.org/video/av123", "https://www.bilibili.com/video/av123?p=0"]:
        with pytest.raises(bilibili.SourceError):
            bilibili.identify(url)
    with pytest.raises(bilibili.SourceError):
        bilibili._media_url("https://example.org/anything.mp4")


def test_import_uses_selected_part_and_discards_partial_stream(tmp_path):
    media = b"\0\0\0\x20ftypisom" + bytes(512)
    metadata = {"bvid":"BV1234567890", "aid":10, "title":"笔记", "pages":[
        {"page":1, "cid":11, "part":"开篇"}, {"page":2, "cid":12, "part":"应用"}]}
    stream = {"size":len(media), "url":"https://first.bilivideo.com/part",
              "backup_url":["https://other.bilivideo.com/part"]}

    def api(path, **params):
        if path == "web-interface/view":
            return metadata
        assert path == "player/playurl" and params["cid"] == 12
        return {"durl":[stream]}

    target = tmp_path / "media"
    with patch.object(bilibili, "_api", api), patch.object(bilibili, "_open", side_effect=[
        BytesIO(media[:64]), BytesIO(media),
    ]):
        result = bilibili.download("https://www.bilibili.com/video/av10?p=2", target)
    assert target.read_bytes() == media and result["title"] == "笔记 · 应用" and result["page"] == 2

    with patch.object(bilibili, "_api", api), patch.object(bilibili, "_open", side_effect=[
        BytesIO(media[:64]), BytesIO(media[:64]),
    ]), pytest.raises(bilibili.SourceError):
        bilibili.download("https://www.bilibili.com/video/av10?p=2", target)
