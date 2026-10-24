"""Opens games picked in Steam's store in Desk of Madness' browser, so the store keeps your place.

Steam's pages can be reached through Chromium's remote debugging port (Decky Loader turns it on). For every
store page we add a small script that catches clicks on links to a game (/app/, /sub/, /bundle/) and hands
the address to us through a CDP binding instead of following it; the frontend then opens it in a new tab
of our browser. Sale pages like Next Fest are built from Steam's gamepad-navigation components, which go to a
game by script rather than by a link click, so we also stop the page itself loading a different game's page
(CDP Fetch, at the request) and open that one in a tab too. Both only act while the frontend says so (the
store or our browser is on screen and the setting is on); otherwise everything behaves as usual.

Only the standard library is used (newer Decky Loader builds leave some of it, and aiohttp, out of reach),
so this has its own tiny WebSocket client: text frames, ping/pong and close, which is all CDP needs.
"""

import asyncio
import base64
import json
import os
import re
import struct
import urllib.request

import decky

DEBUG_HOST = "127.0.0.1"
DEBUG_PORT = 8080
SCAN_SECONDS = 2
STORE_PREFIX = "https://store.steampowered.com/"
BINDING = "__deskOfMadnessOpen"
ITEM = re.compile(r"^https?://store\.steampowered\.com/(app|sub|bundle)/(\d+)", re.I)
# Only a page loading a game's own page is held up; everything else goes straight through.
FETCH_PATTERNS = [
    {"urlPattern": f"{STORE_PREFIX}{kind}/*", "resourceType": "Document", "requestStage": "Request"}
    for kind in ("app", "sub", "bundle")
]

# Runs in each store page (again after every navigation). Clicks on a link to a different game than the
# page's own, and window.open calls for one, are stopped and passed to the binding.
PAGE_SCRIPT = r"""
(() => {
  if (window.__domStoreLinks) return;
  window.__domStoreLinks = true;
  const item = (u) => {
    const m = /^https?:\/\/store\.steampowered\.com\/(app|sub|bundle)\/(\d+)/i.exec(u || "");
    return m ? m[1].toLowerCase() + "/" + m[2] : null;
  };
  document.addEventListener("click", (e) => {
    if (window.__domStoreLinksOn !== true || e.button !== 0 || e.ctrlKey || e.shiftKey || e.metaKey || e.altKey) return;
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    const target = item(a.href);
    if (!target || target === item(location.href) || typeof window.%s !== "function") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    window.%s(JSON.stringify({ url: a.href, from: location.href }));
  }, true);
  const open = window.open;
  window.open = function (u) {
    const url = u ? new URL(String(u), location.href).href : "";
    const target = item(url);
    if (window.__domStoreLinksOn === true && target && target !== item(location.href) && typeof window.%s === "function") {
      window.%s(JSON.stringify({ url, from: location.href }));
      return null;
    }
    return open.apply(this, arguments);
  };
})();
""" % (BINDING, BINDING, BINDING, BINDING)


def _item(url: str):
    m = ITEM.match(url or "")
    return f"{m.group(1).lower()}/{m.group(2)}" if m else None


def _flag_script(on: bool) -> str:
    return f"window.__domStoreLinksOn = {'true' if on else 'false'};"


def _list_targets() -> list:
    with urllib.request.urlopen(f"http://{DEBUG_HOST}:{DEBUG_PORT}/json", timeout=3) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


# ---- a minimal WebSocket client ----

class _Socket:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.reader = reader
        self.writer = writer

    @classmethod
    async def connect(cls, path: str) -> "_Socket":
        reader, writer = await asyncio.wait_for(asyncio.open_connection(DEBUG_HOST, DEBUG_PORT), 5)
        key = base64.b64encode(os.urandom(16)).decode()
        writer.write((
            f"GET {path} HTTP/1.1\r\nHost: {DEBUG_HOST}:{DEBUG_PORT}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        ).encode())
        await writer.drain()
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            writer.close()
            raise ConnectionError(head.split(b"\r\n", 1)[0].decode("latin-1"))
        return cls(reader, writer)

    async def _frame(self, opcode: int, payload: bytes):
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            head = struct.pack("!BB", 0x80 | opcode, 0x80 | n)
        elif n < 65536:
            head = struct.pack("!BBH", 0x80 | opcode, 0x80 | 126, n)
        else:
            head = struct.pack("!BBQ", 0x80 | opcode, 0x80 | 127, n)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.writer.write(head + mask + masked)
        await self.writer.drain()

    async def send(self, text: str):
        await self._frame(0x1, text.encode("utf-8"))

    async def recv(self) -> str:
        """The next text message; raises ConnectionError when the page goes away."""
        parts = []
        while True:
            b1, b2 = await self.reader.readexactly(2)
            opcode, n = b1 & 0x0F, b2 & 0x7F
            if n == 126:
                (n,) = struct.unpack("!H", await self.reader.readexactly(2))
            elif n == 127:
                (n,) = struct.unpack("!Q", await self.reader.readexactly(8))
            mask = await self.reader.readexactly(4) if b2 & 0x80 else None
            data = await self.reader.readexactly(n)
            if mask:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            if opcode == 0x8:
                raise ConnectionError("closed")
            if opcode == 0x9:
                await self._frame(0xA, data)
                continue
            if opcode in (0x0, 0x1, 0x2):
                parts.append(data)
                if b1 & 0x80:
                    return b"".join(parts).decode("utf-8", "replace")

    def close(self):
        try:
            self.writer.close()
        except Exception:
            pass


# ---- the store pages ----

class StoreLinks:
    def __init__(self):
        self.task = None
        self.on = False
        self._pages = {}  # target id -> (socket, task)
        self._ids = 0
        self._warned = False

    async def set_active(self, on: bool):
        self.on = bool(on)
        if self.on and not self.task:
            self.task = asyncio.get_event_loop().create_task(self._scan_loop())
        for sock, _ in list(self._pages.values()):
            await self._call(sock, "Runtime.evaluate", {"expression": _flag_script(self.on)})
        return {"on": self.on, "pages": len(self._pages)}

    async def _call(self, sock: _Socket, method: str, params: dict):
        self._ids += 1
        try:
            await sock.send(json.dumps({"id": self._ids, "method": method, "params": params}))
        except Exception:
            pass  # the page's own task notices it's gone

    async def _scan_loop(self):
        while True:
            try:
                targets = await asyncio.to_thread(_list_targets)
                self._warned = False
            except Exception as e:
                if not self._warned:
                    decky.logger.warning(f"Store links: can't reach Steam's debugging port ({e})")
                    self._warned = True
                targets = []
            for t in targets:
                tid = t.get("id")
                url = str(t.get("url", ""))
                if t.get("type") == "page" and url.startswith(STORE_PREFIX) and tid and tid not in self._pages:
                    self._pages[tid] = (None, asyncio.get_event_loop().create_task(self._watch(tid, url)))
            await asyncio.sleep(SCAN_SECONDS)

    async def _watch(self, tid: str, url: str):
        sock = None
        here = url  # the page's own address, to tell a different game from its own (reloads, redirects)
        main_frame = tid  # a page target's main frame has the target's id
        try:
            sock = await _Socket.connect(f"/devtools/page/{tid}")
            self._pages[tid] = (sock, self._pages[tid][1])
            await self._call(sock, "Runtime.addBinding", {"name": BINDING})
            await self._call(sock, "Runtime.enable", {})  # reports the page's current context, then each new one
            await self._call(sock, "Page.enable", {})
            await self._call(sock, "Fetch.enable", {"patterns": FETCH_PATTERNS})
            while True:
                msg = json.loads(await sock.recv())
                method = msg.get("method")
                params = msg.get("params") or {}
                if method == "Runtime.executionContextCreated":
                    ctx = params.get("context") or {}
                    if (ctx.get("auxData") or {}).get("isDefault") and str(ctx.get("origin", "")).startswith(STORE_PREFIX.rstrip("/")):
                        await self._call(sock, "Runtime.evaluate", {
                            "expression": _flag_script(self.on) + PAGE_SCRIPT,
                            "contextId": ctx.get("id"),
                        })
                elif method == "Page.frameNavigated":
                    frame = params.get("frame") or {}
                    if not frame.get("parentId"):
                        main_frame = frame.get("id") or main_frame
                        here = str(frame.get("url", here))
                elif method == "Fetch.requestPaused":
                    rid = params.get("requestId")
                    to = str((params.get("request") or {}).get("url", ""))
                    if (self.on and params.get("frameId") == main_frame and here.startswith(STORE_PREFIX)
                            and _item(to) and _item(to) != _item(here)):
                        # Aborting a page load leaves the page that was showing as it was.
                        await self._call(sock, "Fetch.failRequest", {"requestId": rid, "errorReason": "Aborted"})
                        await decky.emit("store_link", to, here)
                    else:
                        await self._call(sock, "Fetch.continueRequest", {"requestId": rid})
                elif method == "Runtime.bindingCalled" and params.get("name") == BINDING:
                    try:
                        picked = json.loads(params.get("payload") or "{}")
                    except ValueError:
                        continue
                    url = str(picked.get("url", ""))
                    if url.startswith(STORE_PREFIX):
                        await decky.emit("store_link", url, str(picked.get("from", "")))
        except (ConnectionError, asyncio.IncompleteReadError, OSError, asyncio.TimeoutError, ValueError):
            pass
        except asyncio.CancelledError:
            raise
        except Exception as e:
            decky.logger.warning(f"Store links: page {tid} stopped ({e})")
        finally:
            if sock:
                sock.close()
            self._pages.pop(tid, None)

    async def stop(self):
        await self.set_active(False)  # the pages keep the script; it must stop catching clicks
        if self.task:
            self.task.cancel()
            self.task = None
        for sock, task in list(self._pages.values()):
            if sock:
                sock.close()
            task.cancel()
        self._pages.clear()
