"""Thin wrapper over the Relate Python client.

A Relate connection belongs to the thread that opened it, so every call is
run on one dedicated worker thread. That also serialises writes, which suits
Relate's one-writer-per-store model.
"""
from __future__ import annotations

import atexit
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, TypeVar

import relate

T = TypeVar("T")
_THREAD_PREFIX = "relate-worker"


class Graph:
    def __init__(self, path: str = ":memory:", read_only: bool = False):
        self.path = path
        self._ex = ThreadPoolExecutor(max_workers=1, thread_name_prefix=_THREAD_PREFIX)
        self._conn = self._ex.submit(lambda: relate.connect(path, read_only=read_only)).result()
        self.query_ms = 0.0  # total time spent in queries, for check timing
        self.trace: list | None = None  # when a list, each query's text and Relate's own timing is added
        atexit.register(self.close)  # close before the interpreter shuts down

    # -- thread plumbing -------------------------------------------------
    def _on_worker(self) -> bool:
        return threading.current_thread().name.startswith(_THREAD_PREFIX)

    def run(self, fn: Callable[..., T], *args: Any) -> T:
        """Run fn(*args) on the Relate thread (directly if already there)."""
        if self._on_worker():
            return fn(*args)
        return self._ex.submit(fn, *args).result()

    # -- queries ---------------------------------------------------------
    def q(self, cypher: str, params: dict | None = None) -> list[dict]:
        def go() -> list[dict]:
            t0 = time.perf_counter()
            cur = self._conn.cursor()
            cur.execute(cypher, params or {})
            rows = cur.fetchall()
            self.query_ms += (time.perf_counter() - t0) * 1000
            if self.trace is not None:
                s = cur.consume()
                ptext = json.dumps(params or {}, default=str)
                self.trace.append({"cypher": cypher.strip(), "rows": len(rows), "ms": round(s.elapsed_ms or 0, 2),
                                   "params": (params or {}) if len(ptext) < 1500 else None,
                                   "parse_ms": round(s.parse_ms or 0, 3), "plan_ms": round(s.plan_ms or 0, 3),
                                   "execute_ms": round(s.execute_ms or 0, 2),
                                   "notices": [n.get("code") if isinstance(n, dict) else str(n)
                                               for n in (s.notifications or [])][:3]})
            return rows

        return self.run(go)

    def one(self, cypher: str, params: dict | None = None) -> dict | None:
        rows = self.q(cypher, params)
        return rows[0] if rows else None

    # -- transactions ----------------------------------------------------
    def draft(self, fn: Callable[["Graph"], T]) -> T:
        """Run fn inside a transaction and always roll it back.

        Used to test a layout without changing the accepted floor.
        """

        def go() -> T:
            self._conn.autocommit = False
            try:
                return fn(self)
            finally:
                self._conn.rollback()
                self._conn.autocommit = True

        return self.run(go)

    def commit(self, fn: Callable[["Graph"], T]) -> T:
        """Run fn inside a transaction; commit if it returns, roll back if it raises."""

        def go() -> T:
            self._conn.autocommit = False
            try:
                out = fn(self)
                self._conn.commit()
                return out
            except BaseException:
                self._conn.rollback()
                raise
            finally:
                self._conn.autocommit = True

        return self.run(go)

    def close(self) -> None:
        if getattr(self, "_conn", None) is not None:
            conn, self._conn = self._conn, None
            try:
                self.run(conn.close)
            except RuntimeError:  # the worker pool was already shut down at interpreter exit
                pass
        self._ex.shutdown(wait=True)
