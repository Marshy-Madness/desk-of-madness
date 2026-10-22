"""Reaches into the browser's full-page view, which is a Steam browser of its own that our UI can't touch.

Like storelinks.py it goes through Chromium's remote debugging port: the left trackpad's scrolling is sent
as mouse-wheel turns, and the left stick's picking runs a script in the page.
"""

import asyncio
import json

import decky

from storelinks import _Socket, _list_targets


def _same_page(a: str, b: str) -> bool:
    return a.split("#", 1)[0].rstrip("/") == b.split("#", 1)[0].rstrip("/")


class PageControl:
    def __init__(self):
        self.sock = None
        self.url = ""
        self.ids = 0
        self.waiting = {}  # request id -> future
        self.task = None
        self.lock = asyncio.Lock()

    async def _connect(self, url: str) -> _Socket:
        if self.sock and _same_page(self.url, url):
            return self.sock
        self.close()
        targets = await asyncio.to_thread(_list_targets)
        page = next((t for t in targets if t.get("type") == "page" and _same_page(str(t.get("url", "")), url)), None)
        if not page:
            raise LookupError("the page isn't open")
        self.sock = await _Socket.connect(f"/devtools/page/{page['id']}")
        self.url = url
        self.task = asyncio.get_event_loop().create_task(self._listen(self.sock))
        return self.sock

    async def _listen(self, sock: _Socket):
        try:
            while True:
                msg = json.loads(await sock.recv())
                fut = self.waiting.pop(msg.get("id"), None)
                if fut and not fut.done():
                    fut.set_result(msg)
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        finally:
            if self.sock is sock:
                self.sock = None
                self.url = ""
            for fut in self.waiting.values():
                if not fut.done():
                    fut.set_exception(ConnectionError("the page went away"))
            self.waiting.clear()

    async def call(self, url: str, method: str, params: dict) -> dict:
        async with self.lock:
            sock = await self._connect(url)
        self.ids += 1
        fut = asyncio.get_event_loop().create_future()
        self.waiting[self.ids] = fut
        await sock.send(json.dumps({"id": self.ids, "method": method, "params": params}))
        msg = await asyncio.wait_for(fut, 5)
        if "error" in msg:
            raise RuntimeError(msg["error"].get("message", "failed"))
        return msg.get("result") or {}

    async def wheel(self, url: str, x: float, y: float, dy: float):
        await self.call(url, "Input.dispatchMouseEvent", {"type": "mouseWheel", "x": x, "y": y, "deltaX": 0, "deltaY": dy})

    async def evaluate(self, url: str, expression: str):
        result = await self.call(url, "Runtime.evaluate", {"expression": expression, "returnByValue": True})
        if result.get("exceptionDetails"):
            decky.logger.warning(f"Page script failed: {result['exceptionDetails'].get('text')}")
            return None
        return (result.get("result") or {}).get("value")

    def close(self):
        if self.task:
            self.task.cancel()
            self.task = None
        if self.sock:
            self.sock.close()
            self.sock = None
        self.url = ""
