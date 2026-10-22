"""Reads the Steam Deck's built-in controller straight from its hidraw device, for the button combos.

Steam's own button callbacks don't reach plugins on current SteamOS, but hidraw hands every reader its own
copy of each input report, so we can listen alongside Steam without taking anything away from it.
"""

import asyncio
try:
    import glob
except ImportError:  # not in newer Decky Loader builds
    from compat import glob
import os
import struct

import decky

DECK_HID_ID = "000028DE:00001205"  # Valve, Steam Deck controller
REPORT_SIZE = 64
REPORT_STATE = 0x09
RESCAN_SECONDS = 5
STICK_OFFSET = 52  # right stick X, Y (int16; Y positive = up) in a state report
STICK_INTERVAL = 0.033  # at most ~30 updates a second to the frontend
STICK_MOVE = 1500  # ignore smaller changes than this
# The browser's feed: the left trackpad scrolls and the left stick picks bits of the page.
LPAD_OFFSET = 16  # left trackpad X, Y (int16; Y positive = up)
LSTICK_OFFSET = 48  # left stick X, Y (int16; Y positive = up)
LPAD_TOUCH = 0x80000  # in the low button word: a thumb is on the left trackpad
PAD_INTERVAL = 0.016  # at most ~60 updates a second to the frontend
PAD_STEP = 96  # trackpad movement smaller than this isn't sent
PAD_STICK_STEP = 4096  # nor stick movement smaller than this

# Bits of the two button words in a state report (the same layout Steam and SDL use). Touch-only bits
# (trackpads, sticks) are left out: they'd be "held" whenever a thumb rests there.
LO_BITS = [
    (0x1, "R2"), (0x2, "L2"), (0x4, "R1"), (0x8, "L1"),
    (0x10, "Y"), (0x20, "B"), (0x40, "X"), (0x80, "A"),
    (0x100, "UP"), (0x200, "RIGHT"), (0x400, "LEFT"), (0x800, "DOWN"),
    (0x1000, "VIEW"), (0x2000, "STEAM"), (0x4000, "MENU"),
    (0x8000, "L5"), (0x10000, "R5"), (0x20000, "LPAD"), (0x40000, "RPAD"),
    (0x400000, "L3"), (0x4000000, "R3"),
]
HI_BITS = [(0x200, "L4"), (0x400, "R4"), (0x40000, "QAM")]
LO_MASK = sum(b for b, _ in LO_BITS)
HI_MASK = sum(b for b, _ in HI_BITS)


def _deck_nodes() -> list:
    nodes = []
    for uevent in glob.glob("/sys/class/hidraw/hidraw*/device/uevent"):
        try:
            with open(uevent) as f:
                if DECK_HID_ID in f.read().upper():
                    nodes.append("/dev/" + uevent.split("/")[4])
        except OSError:
            pass
    return nodes


class Buttons:
    task = None

    def __init__(self):
        self.fds = {}
        self.state = None  # (lo, hi) of the buttons we care about
        self.error = None
        # The right stick is only sent while the radial menu is open (it changes constantly).
        self.stick_on = False
        self.stick = (0, 0)
        self.stick_sent = 0.0
        # The left trackpad and stick, only while the browser is on screen.
        self.pad_on = False
        self.pad = None  # what was last sent, rounded
        self.pad_latest = None
        self.pad_sent = 0.0
        self.pad_timer = None

    def status(self) -> dict:
        return {"devices": len(self.fds), "error": self.error}

    async def loop(self):
        loop = asyncio.get_event_loop()
        try:
            while True:
                if not self.fds:
                    self._open(loop)
                await asyncio.sleep(RESCAN_SECONDS)
        finally:
            self._close_all(loop)

    def _open(self, loop):
        nodes = _deck_nodes()
        if not nodes:
            self.error = "no Steam Deck controller found"
            return
        for path in nodes:
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            except OSError as e:
                self.error = f"can't open {path}: {e.strerror}"
                continue
            self.fds[fd] = path
            loop.add_reader(fd, self._read, loop, fd)
        if self.fds:
            self.error = None
            decky.logger.info(f"Reading Deck buttons from {', '.join(self.fds.values())}")

    def _close(self, loop, fd):
        loop.remove_reader(fd)
        self.fds.pop(fd, None)
        try:
            os.close(fd)
        except OSError:
            pass

    def _close_all(self, loop):
        for fd in list(self.fds):
            self._close(loop, fd)

    def _read(self, loop, fd):
        try:
            data = os.read(fd, REPORT_SIZE)
        except BlockingIOError:
            return
        except OSError:
            self._close(loop, fd)  # unplugged or reset; the loop opens it again
            return
        # Header: report version (u16), type, length; then packet number (u32) and the two button words.
        if len(data) < 16 or data[2] != REPORT_STATE:
            return
        lo, hi = struct.unpack_from("<II", data, 8)
        if self.stick_on and len(data) >= STICK_OFFSET + 4:
            self._send_stick(loop, struct.unpack_from("<hh", data, STICK_OFFSET))
        if self.pad_on and len(data) >= LSTICK_OFFSET + 4:
            touched = bool(lo & LPAD_TOUCH)
            pad_x, pad_y = struct.unpack_from("<hh", data, LPAD_OFFSET)
            sx, sy = struct.unpack_from("<hh", data, LSTICK_OFFSET)
            self._feed_pad(loop, (touched, pad_x if touched else 0, pad_y if touched else 0, sx, sy))
        state = (lo & LO_MASK, hi & HI_MASK)
        if state == self.state:
            return
        self.state = state
        names = [n for b, n in LO_BITS if state[0] & b] + [n for b, n in HI_BITS if state[1] & b]
        loop.create_task(decky.emit("buttons", names))

    def set_stick_feed(self, on: bool):
        self.stick_on = bool(on)
        self.stick = (0, 0)

    def _send_stick(self, loop, stick):
        now = loop.time()
        moved = abs(stick[0] - self.stick[0]) + abs(stick[1] - self.stick[1])
        if moved < STICK_MOVE or now - self.stick_sent < STICK_INTERVAL:
            return
        self.stick = stick
        self.stick_sent = now
        loop.create_task(decky.emit("stick", stick[0], stick[1]))

    def set_pad_feed(self, on: bool):
        self.pad_on = bool(on)
        self.pad = None
        if self.pad_timer:
            self.pad_timer.cancel()
            self.pad_timer = None

    def _feed_pad(self, loop, pad):
        # Rate-limited, but the latest state always goes out in the end, so a released stick reads as released.
        self.pad_latest = pad
        if self.pad_timer:
            return
        wait = self.pad_sent + PAD_INTERVAL - loop.time()
        if wait > 0:
            self.pad_timer = loop.call_later(wait, self._flush_pad, loop)
        else:
            self._flush_pad(loop)

    def _flush_pad(self, loop):
        self.pad_timer = None
        if not self.pad_on or self.pad_latest is None:
            return
        touched, x, y, sx, sy = self.pad_latest
        rounded = (touched, round(x / PAD_STEP), round(y / PAD_STEP), round(sx / PAD_STICK_STEP), round(sy / PAD_STICK_STEP))
        if rounded == self.pad:
            return
        self.pad = rounded
        self.pad_sent = loop.time()
        loop.create_task(decky.emit("pad", touched, x, y, sx, sy))
