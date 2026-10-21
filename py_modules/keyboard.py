"""Reads keyboards straight from their /dev/input event devices, for keyboard shortcuts on the combos.

Like the controller reader, this only listens: without a grab every reader gets its own copy of each key,
so games and Steam still see them. Event devices belong to the "input" group, so the plugin's user has to
be in it (the status says so when it isn't).
"""

import asyncio
import os
import re
import struct

import decky

RESCAN_SECONDS = 5
EVENT = struct.Struct("llHHi")  # struct input_event: timeval, type, code, value
EV_KEY = 0x01
KEY_A = 30
VALVE_VENDOR = "28de"  # the Deck controller's own keyboard (lizard mode) and Steam's virtual devices

# Linux key codes. Left and right modifiers share a name, so Ctrl means either Ctrl.
NAMES = {
    1: "ESC", 14: "BACKSPACE", 15: "TAB", 28: "ENTER", 57: "SPACE", 58: "CAPSLOCK", 69: "NUMLOCK",
    70: "SCROLLLOCK", 99: "PRINT", 119: "PAUSE", 127: "MENU",
    29: "CTRL", 97: "CTRL", 42: "SHIFT", 54: "SHIFT", 56: "ALT", 100: "ALT", 125: "META", 126: "META",
    12: "-", 13: "=", 26: "[", 27: "]", 39: ";", 40: "'", 41: "`", 43: "\\", 51: ",", 52: ".", 53: "/",
    102: "HOME", 103: "UP", 104: "PAGEUP", 105: "LEFT", 106: "RIGHT", 107: "END", 108: "DOWN",
    109: "PAGEDOWN", 110: "INSERT", 111: "DELETE",
    55: "NUM*", 74: "NUM-", 78: "NUM+", 83: "NUM.", 96: "NUMENTER", 98: "NUM/",
    71: "NUM7", 72: "NUM8", 73: "NUM9", 75: "NUM4", 76: "NUM5", 77: "NUM6", 79: "NUM1", 80: "NUM2",
    81: "NUM3", 82: "NUM0",
}
NAMES.update({2 + i: str((i + 1) % 10) for i in range(10)})  # 1-9, 0
for row, start in (("QWERTYUIOP", 16), ("ASDFGHJKL", 30), ("ZXCVBNM", 44)):
    NAMES.update({start + i: c for i, c in enumerate(row)})
NAMES.update({59 + i: f"F{i + 1}" for i in range(10)})
NAMES.update({87: "F11", 88: "F12"})
NAMES.update({183 + i: f"F{i + 13}" for i in range(12)})
# Volume, media and power keys are left out: the system already uses them.
IGNORED = set(range(112, 119)) | set(range(140, 183)) | {116, 142}


def _keyboards() -> list:
    """Event devices that have letter keys, from /proc/bus/input/devices (mice and pads don't)."""
    try:
        with open("/proc/bus/input/devices") as f:
            blocks = f.read().split("\n\n")
    except OSError:
        return []
    found = []
    for block in blocks:
        vendor = re.search(r"Vendor=([0-9a-f]+)", block)
        handlers = re.search(r"Handlers=.*?\b(event\d+)", block)
        keys = re.search(r"B: KEY=([0-9a-f ]+)", block)
        if not handlers or not keys or (vendor and vendor.group(1) == VALVE_VENDOR):
            continue
        # The bitmap is 64-bit words, highest first; bit KEY_A sits in the last word.
        lowest = int(keys.group(1).split()[-1], 16)
        if lowest & (1 << KEY_A):
            found.append("/dev/input/" + handlers.group(1))
    return found


class Keyboard:
    task = None

    def __init__(self):
        self.fds = {}  # fd -> path
        self.held = {}  # fd -> set of key codes
        self.sent = None
        self.error = None

    def status(self) -> dict:
        return {"devices": len(self.fds), "error": self.error}

    async def loop(self):
        loop = asyncio.get_event_loop()
        try:
            while True:
                self._open(loop)
                await asyncio.sleep(RESCAN_SECONDS)
        finally:
            for fd in list(self.fds):
                self._close(loop, fd)

    def _open(self, loop):
        paths = _keyboards()
        open_paths = set(self.fds.values())
        denied = False
        for path in paths:
            if path in open_paths:
                continue
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            except PermissionError:
                denied = True
                continue
            except OSError:
                continue
            self.fds[fd] = path
            self.held[fd] = set()
            loop.add_reader(fd, self._read, loop, fd)
            decky.logger.info(f"Reading keyboard keys from {path}")
        if self.fds:
            self.error = None
        elif denied:
            self.error = "no permission to read keyboards: add your user to the input group"
        else:
            self.error = "no keyboard found" if not paths else None

    def _close(self, loop, fd):
        loop.remove_reader(fd)
        self.fds.pop(fd, None)
        self.held.pop(fd, None)
        try:
            os.close(fd)
        except OSError:
            pass
        self._send(loop)

    def _read(self, loop, fd):
        try:
            data = os.read(fd, EVENT.size * 64)
        except BlockingIOError:
            return
        except OSError:
            self._close(loop, fd)  # unplugged; the next scan opens it again if it comes back
            return
        held = self.held.get(fd)
        if held is None:
            return
        for i in range(0, len(data) - EVENT.size + 1, EVENT.size):
            _, _, kind, code, value = EVENT.unpack_from(data, i)
            if kind != EV_KEY or code in IGNORED or code >= 0x100:  # 0x100 and up are mouse and pad buttons
                continue
            if value == 1:
                held.add(code)
            elif value == 0:
                held.discard(code)
            # 2 is key repeat: nothing changes
        self._send(loop)

    def _send(self, loop):
        names = sorted({NAMES.get(c, f"KEY{c}") for keys in self.held.values() for c in keys})
        if names == self.sent:
            return
        self.sent = names
        loop.create_task(decky.emit("keys", names))
