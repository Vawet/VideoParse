"""Create a private Compose environment once. Run from any directory."""
import os
import secrets
from pathlib import Path

path = Path(__file__).resolve().with_name(".env")
with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as output:
    for key in ("MYSQL_ROOT_PASSWORD", "DB_PASSWORD", "REDIS_PASSWORD", "MINIO_SECRET_KEY", "QDRANT_API_KEY", "UPLOAD_ANSWER"):
        print(f"{key}={secrets.token_hex(24)}", file=output)
print("已生成独立部署配置。请在本机配置模型服务和上传口令。")
