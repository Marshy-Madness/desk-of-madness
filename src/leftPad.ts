import { useEffect, useRef } from "react";
import { addEventListener, removeEventListener } from "@decky/api";
import { backend } from "./api/backend";
import { getSettings } from "./state/notesStore";

// The browser's left trackpad and left stick, read straight from the Deck's controller by the backend
// (py_modules/buttons.py), since Steam's own trackpad mode doesn't reach our pages. The trackpad scrolls in
// one of two ways (Settings): drawing circles, clockwise down the page (the default), or sliding the thumb
// as on a touch screen (it keeps going a little when it lets go). The stick picks the next or previous bit
// of the page, again and again while it's held.

const PAD_RANGE = 65536;
const STICK_ON = 0.5; // how far the stick goes before it picks
const STICK_OFF = 0.3; // and how far back before it's let go
const STICK_ACTIVE = 0.15; // further than this and Steam's own stick navigation is ignored
const REPEAT_FIRST = 400;
const REPEAT_NEXT = 170;
const CIRCLE_TURN = 0.9; // one full circle scrolls this many screens
const CIRCLE_MIN_RADIUS = 0.2; // of the trackpad's width; nearer the middle the angle is too jumpy
const FRICTION = 0.92; // per frame, after the thumb lets go
const MIN_SPEED = 0.3; // px per frame

export interface LeftPadHandlers {
  /** Scroll by this many pixels (positive: further down the page). */
  scroll(px: number): void;
  /** How tall the scrolled area is; scrolling is measured in these. */
  height(): number;
  /** Pick the next (1) or previous (-1) bit of the page. */
  step(dir: 1 | -1): void;
}

/** While `on`, the left trackpad and stick work the page. Returns refs saying whether each is in use. */
export function useLeftPad(on: boolean, handlers: LeftPadHandlers) {
  const h = useRef(handlers);
  h.current = handlers;
  const touched = useRef(false);
  const stickActive = useRef(false);

  useEffect(() => {
    if (!on) return;
    let lastY = 0;
    let lastAngle: number | null = null;
    let lastAt = 0;
    let speed = 0; // px per frame
    let glide = 0;
    let held: 0 | 1 | -1 = 0;
    let repeat: ReturnType<typeof setTimeout> | undefined;

    const stopGlide = () => {
      cancelAnimationFrame(glide);
      glide = 0;
    };
    const startGlide = () => {
      const frame = () => {
        speed *= FRICTION;
        if (Math.abs(speed) < MIN_SPEED) return stopGlide();
        h.current.scroll(speed);
        glide = requestAnimationFrame(frame);
      };
      glide = requestAnimationFrame(frame);
    };
    const hold = (dir: 0 | 1 | -1) => {
      if (dir === held) return;
      held = dir;
      clearTimeout(repeat);
      if (!dir) return;
      const again = (wait: number) => {
        repeat = setTimeout(() => {
          h.current.step(dir);
          again(REPEAT_NEXT);
        }, wait);
      };
      h.current.step(dir);
      again(REPEAT_FIRST);
    };

    const circle = (x: number, y: number) => {
      if (Math.hypot(x, y) < CIRCLE_MIN_RADIUS * PAD_RANGE) {
        lastAngle = null;
        return;
      }
      const angle = Math.atan2(y, x); // anticlockwise is positive
      if (lastAngle !== null) {
        let turn = lastAngle - angle; // clockwise is positive: down the page
        if (turn > Math.PI) turn -= Math.PI * 2;
        else if (turn < -Math.PI) turn += Math.PI * 2;
        const px = (turn / (Math.PI * 2)) * h.current.height() * CIRCLE_TURN;
        if (px) h.current.scroll(px);
      }
      lastAngle = angle;
    };

    const onPad = (isTouched: boolean, x: number, y: number, _sx: number, sy: number) => {
      const now = performance.now();
      const circles = getSettings().padScroll !== "swipe";
      if (isTouched && circles) {
        if (!touched.current) {
          stopGlide();
          lastAngle = null;
        }
        circle(x, y);
      } else if (isTouched) {
        if (!touched.current) stopGlide();
        else {
          // Thumb up (y grows) moves the page up, as on the touch screen.
          const px = ((y - lastY) / PAD_RANGE) * h.current.height() * 1.5;
          if (px) h.current.scroll(px);
          const frames = Math.max(1, (now - lastAt) / 16.7);
          speed = speed * 0.5 + (px / frames) * 0.5;
        }
        lastY = y;
        lastAt = now;
      } else if (!circles && touched.current && now - lastAt < 80 && Math.abs(speed) > 2) {
        startGlide();
      }
      touched.current = isTouched;

      const f = sy / 32767; // up is positive
      stickActive.current = Math.abs(f) > STICK_ACTIVE;
      if (Math.abs(f) >= STICK_ON) hold(f > 0 ? -1 : 1);
      else if (Math.abs(f) < STICK_OFF) hold(0);
    };

    backend.padFeed(true).catch(() => {});
    addEventListener("pad", onPad);
    return () => {
      removeEventListener("pad", onPad);
      backend.padFeed(false).catch(() => {});
      stopGlide();
      clearTimeout(repeat);
      touched.current = false;
      stickActive.current = false;
    };
  }, [on]);

  return { touched, stickActive };
}
