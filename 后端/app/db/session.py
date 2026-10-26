"""引擎与会话（懒加载，URL 在首次使用时读取，便于测试覆盖 config.DATABASE_URL）。"""
import threading
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import config

_engine = None
_Session = None
_lock = threading.Lock()


def _get_engine():
    global _engine, _Session
    with _lock:
        if _engine is None:
            url = config.DATABASE_URL
            kwargs = {"future": True}
            if url.startswith("sqlite"):
                kwargs["connect_args"] = {"check_same_thread": False}
            _engine = create_engine(url, **kwargs)
            _Session = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
            from app.db.models import Base
            Base.metadata.create_all(_engine)
    return _engine


def init_db():
    return _get_engine()


def reset_engine():
    """丢弃当前引擎（测试里切换 DATABASE_URL 后调用）。"""
    global _engine, _Session
    with _lock:
        if _engine is not None:
            _engine.dispose()
        _engine = _Session = None


@contextmanager
def get_session():
    _get_engine()
    session = _Session()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
