"""Import an offline SQLite snapshot into an empty platform learning schema."""
import argparse
import sqlite3
import os
from pathlib import Path
from sqlalchemy import create_engine, select
from app.db.models import Base


def migrate(source, target_url):
    if not source.is_file() or not target_url.startswith("mysql+pymysql://"):
        raise ValueError("需要现有 SQLite 文件和独立的 MySQL 目标库")
    origin = create_engine("sqlite://", creator=lambda: sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True))
    target = create_engine(target_url, hide_parameters=True)
    try:
        with origin.connect() as old, target.begin() as new:
            # Abort before writing anything if this is a used learning database.
            for table in Base.metadata.sorted_tables:
                if new.execute(select(next(iter(table.primary_key.columns))).limit(1)).first():
                    raise ValueError(f"目标表 {table.name} 非空，取消导入")
            for table in Base.metadata.sorted_tables:
                count = 0
                for batch in old.execute(select(table)).mappings().partitions(500):
                    rows = [dict(row) for row in batch]
                    new.execute(table.insert(), rows)
                    count += len(rows)
                print(f"{table.name}: {count}")
    finally:
        target.dispose()
        origin.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    migrate(args.source, os.environ["DATABASE_URL"])
