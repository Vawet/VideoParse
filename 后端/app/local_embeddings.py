"""Cached local embeddings for the private Java worker and the Python retriever."""
import json
import logging
import os
import sys

DEFAULT_MODEL = "BAAI/bge-small-zh-v1.5"
QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章："


def main():
    # This worker only serves cached weights. Provision them outside the request path.
    os.environ["HF_HUB_OFFLINE"] = "1"
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(os.environ.get("EMBED_MODEL", DEFAULT_MODEL), local_files_only=True)
    for line in sys.stdin:
        request = json.loads(line)
        args = request["args"]
        texts = args["texts"]
        if request["tool"] != "embed" or not isinstance(texts, list) or not 1 <= len(texts) <= 24:
            raise ValueError("非法向量请求")
        if not all(isinstance(text, str) and len(text) <= 4000 for text in texts):
            raise ValueError("文本超长")
        if args["query"]:
            texts = [QUERY_PREFIX + text for text in texts]
        vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        print("VP_RESULT " + json.dumps(vectors.tolist(), allow_nan=False), flush=True)


if __name__ == "__main__":
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    main()
