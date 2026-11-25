"""Generate private Compose credentials or extend an existing installation with Neo4j."""
import argparse
import os
import secrets
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--add-graph", action="store_true", help="给已有配置补充 Neo4j 凭据")
args = parser.parse_args()
path = Path(__file__).resolve().with_name(".env")

if args.add_graph:
    with path.open("r+", encoding="utf-8") as output:
        if not any(line.partition("=")[0].strip() == "NEO4J_PASSWORD" for line in output):
            output.seek(0, os.SEEK_END)
            output.write("\nNEO4J_PASSWORD=" + secrets.token_hex(24) + "\n")
else:
    with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as output:
        for key in ("MYSQL_ROOT_PASSWORD", "DB_PASSWORD", "REDIS_PASSWORD", "MINIO_SECRET_KEY", "QDRANT_API_KEY", "NEO4J_PASSWORD", "UPLOAD_ANSWER"):
            print(f"{key}={secrets.token_hex(24)}", file=output)
print("平台凭据已就绪。")
