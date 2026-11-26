"""Append one durable receipt per outbound attempt. Never store headers or message bodies."""
import json
import logging
import os
import time
from contextlib import contextmanager
from contextvars import ContextVar
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from threading import Lock

from openai import DefaultHttpxClient
from sqlalchemy import (BigInteger, Column, Index, Integer, MetaData, String, Table,
                        case, create_engine, func, select, update)
from sqlalchemy.engine import make_url

from app import config

log = logging.getLogger(__name__)
_owner = ContextVar("usage_owner", default=None)
_operation = ContextVar("usage_operation", default=None)
metadata = MetaData()
receipts = Table("vp_api_usage", metadata,
    Column("id", BigInteger().with_variant(Integer, "sqlite"), primary_key=True),
    Column("owner_id", String(32), nullable=False),
    Column("started_ms", BigInteger, nullable=False),
    Column("operation", String(80), nullable=False),
    Column("provider", String(255), nullable=False),
    Column("model", String(200), nullable=False),
    Column("status", String(16), nullable=False),
    Column("input_tokens", BigInteger),
    Column("output_tokens", BigInteger),
    Column("total_tokens", BigInteger),
    Column("estimated_usd_micros", BigInteger),
    Index("ix_api_usage_owner", "owner_id", "id"))
_init_lock = Lock()


@lru_cache(maxsize=4)
def _engine(url):
    parsed = make_url(url)
    if parsed.get_backend_name() == "sqlite" and parsed.database not in (None, "", ":memory:"):
        # A learning operation may already hold SQLite's single writer lock.
        parsed = parsed.set(database=parsed.database + ".usage.db")
    engine = create_engine(parsed, pool_pre_ping=True)
    # Flyway owns the platform schema. Standalone Flask also supports PostgreSQL.
    if parsed.get_backend_name() != "mysql":
        metadata.create_all(engine)
    return engine


def _store():
    with _init_lock:
        return _engine(config.DATABASE_URL)


@contextmanager
def scope(operation, owner=None):
    op_token = _operation.set(operation)
    owner_token = _owner.set(owner or _owner.get())
    try:
        yield
    finally:
        _owner.reset(owner_token)
        _operation.reset(op_token)


def start(provider, model):
    owner = _owner.get() or os.environ.get("VP_USAGE_OWNER") or "local"
    operation = _operation.get() or os.environ.get("VP_USAGE_OPERATION")
    if not operation:
        from flask import has_request_context, request
        operation = request.endpoint if has_request_context() else "model_call"
    with _store().begin() as conn:
        row = conn.execute(receipts.insert().values(
            owner_id=owner, started_ms=time.time_ns() // 1_000_000, operation=operation[:80],
            provider=provider[:255], model=model[:200], status="awaiting"))
        return row.inserted_primary_key[0]


def finish(row, status, *, usage=None, estimate=None):
    def count(key):
        n = usage.get(key) if isinstance(usage, dict) else None
        return n if type(n) is int and 0 <= n < 2**63 else None

    incoming, outgoing, total = (count(k) for k in ("prompt_tokens", "completion_tokens", "total_tokens"))
    if total is None and incoming is not None and outgoing is not None:
        total = incoming + outgoing
    prefix = "failed_" if status == "failed" else ""
    if total is not None:
        status = prefix + "reported"
    elif incoming is not None or outgoing is not None:
        status = prefix + "partial"
    try:
        with _store().begin() as conn:
            conn.execute(update(receipts).where(receipts.c.id == row).values(
                status=status, input_tokens=incoming, output_tokens=outgoing,
                total_tokens=total, estimated_usd_micros=estimate))
    except Exception:
        # The attempt is already durable. A receipt write failure must never replay a paid call.
        log.error("API 用量回执未能更新，记录 %s 待核对", row)


class MeteredHttpClient(DefaultHttpxClient):
    """The SDK calls send again on each retry, before parsing completion content."""
    def send(self, request, **kwargs):
        model = json.loads(request.content).get("model", "")
        row = start(request.url.host, model)
        try:
            response = super().send(request, **kwargs)
            response.read()
        except Exception:
            finish(row, "failed")
            raise
        try:
            body = response.json()
        except (ValueError, UnicodeError):
            body = {}
        finish(row, "unreported" if response.is_success else "failed",
               usage=body.get("usage") if isinstance(body, dict) else None)
        return response


def brave_price_micros():
    # Brave Search plan list price, before credits. Deployments may specify their contract.
    try:
        price = Decimal(os.getenv("BRAVE_USD_PER_REQUEST", "0.005")) * 1_000_000
        if price.is_finite() and 0 <= price < 2**63 and price == price.to_integral_value():
            return int(price)
    except InvalidOperation:
        pass
    return None


def page(owner, before=None):
    c = receipts.c
    known_tokens = func.coalesce(c.total_tokens, func.coalesce(c.input_tokens, 0) + func.coalesce(c.output_tokens, 0))
    with _store().connect() as conn:
        totals = conn.execute(select(func.count().label("requests"),
            func.coalesce(func.sum(known_tokens), 0).label("tokens"),
            func.coalesce(func.sum(c.estimated_usd_micros), 0).label("estimated_usd_micros"),
            func.count(case((c.total_tokens.is_(None) & c.estimated_usd_micros.is_(None), 1))).label("unconfirmed")
        ).where(c.owner_id == owner)).mappings().one()
        fields = [col for col in receipts.c if col.name != "owner_id"]
        items = select(*fields).where(c.owner_id == owner)
        if before is not None:
            items = items.where(c.id < before)
        rows = conn.execute(items.order_by(c.id.desc()).limit(31)).mappings().all()
    return dict(success=True, summary={k: int(v) for k, v in totals.items()},
                items=[dict(row) for row in rows[:30]], next=rows[29]["id"] if len(rows) > 30 else None)
