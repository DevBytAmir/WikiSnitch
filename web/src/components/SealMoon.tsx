import { useEffect, useRef, useState } from "react";

// Both hero images live in public/hero so index.html can start downloading them on the home page before the app's
// code has loaded. The seal is a transparent mask drawn by CSS (.seal-moon-seal), the moon is drawn on the canvas.
const MOON_URL = "/hero/moon.webp";

// Stage layout. The seal fills the bottom; the band of PAD source pixels above it holds the moon.
const SC = 1.5; // canvas pixels per source pixel
const SEAL_W = 784;
const SEAL_H = 716;
const PAD = 250;
const W = SEAL_W * SC;
const H = (PAD + SEAL_H) * SC;
// Radius 5% over the source layout's 96; the centre sits lower so the top of the orbit ring stays put.
const MOON = { x: 300 * SC, y: 134 * SC, r: 100.8 * SC };
const MOON_SRC = { size: 272, r: 131.5 }; // the moon image, and the radius of the disc in it
const MOON_PAPER = "#faf7ee";
const TAU = Math.PI * 2;
const CYCLE_SECONDS = 36 / 1.15; // one lunar cycle when turning by itself (about 31 s)
const RESUME_AFTER_MS = 1000; // after the reader lets go, the moon turns by itself again
const START_ANGLE = -0.9; // rotation of the moon in radians; full moon at 0, face upright when brightest

// The decorative network around the moon, arranged by hand. Units: 1000 = stage width, from the
// stage's top-left corner; it reaches well outside the stage, behind the hero text. `half` is half a box's side.
type WebPoint = { x: number; y: number; half: number; label?: string };
const STAGE_UNITS_H = (1000 * H) / W;
const WEB_POINTS: Record<string, WebPoint> = {
  moon: { x: (MOON.x / W) * 1000, y: (MOON.y / W) * 1000, half: ((MOON.r * 1.2) / W) * 1000 }, // the orbit ring
  a: { x: -968, y: -65, half: 37, label: "2.2857" },
  b: { x: -319, y: 48, half: 55, label: "2.8571" },
  c: { x: 24, y: 145, half: 38, label: "1.5714" },
  d: { x: -113, y: 321, half: 31, label: "1.0000" },
  e: { x: -250, y: 485, half: 46, label: "0.5714" },
  f: { x: -388, y: 906, half: 37, label: "0.7143" },
  g: { x: -147, y: 1228, half: 49, label: "2.4286" },
  h: { x: 708, y: 81, half: 41, label: "1.4286" },
  i: { x: 1153, y: -33, half: 33, label: "1.0000" },
  j: { x: 1220, y: 615, half: 46, label: "1.5714" },
  k: { x: 1118, y: 1066, half: 37, label: "1.7143" },
};
const WEB_EDGES: [string, string][] = [
  ["a", "b"], ["b", "c"], ["c", "moon"], ["c", "d"], ["d", "e"], ["e", "f"], ["f", "g"],
  ["moon", "h"], ["h", "i"], ["h", "j"], ["j", "k"],
];

const phaseOf = (a: number) => (((0.5 + a / TAU) % 1) + 1) % 1; // 0 new, 0.5 full
const illumination = (p: number) => (1 - Math.cos(TAU * p)) / 2;
const degrees = (a: number) => ((((a * 180) / Math.PI) % 360) + 360) % 360;
const litText = (p: number) => `${Math.round(illumination(p) * 100)}% lit`;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function phaseName(p: number): string {
  if (p < 0.03 || p > 0.97) return "New moon";
  if (p < 0.235) return "Waxing crescent";
  if (p < 0.265) return "First quarter";
  if (p < 0.47) return "Waxing gibbous";
  if (p < 0.53) return "Full moon";
  if (p < 0.735) return "Waning gibbous";
  if (p < 0.765) return "Last quarter";
  return "Waning crescent";
}

/** Outline of the dark side in moon-local coordinates. The terminator stays in screen space (light comes
 *  from the side); only the face rotates. */
function shadowPath(c: CanvasRenderingContext2D, p: number, r: number): void {
  const cos = Math.cos(TAU * p);
  const n = 72;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const y = -r + (2 * r * i) / n;
    const s = Math.sqrt(Math.max(0, r * r - y * y));
    if (p < 0.5) {
      left.push([-s, y]); // waxing: dark on the left
      right.push([cos * s, y]);
    } else {
      left.push([-cos * s, y]); // waning: dark on the right
      right.push([s, y]);
    }
  }
  c.beginPath();
  c.moveTo(left[0][0], left[0][1]);
  for (const [x, y] of left) c.lineTo(x, y);
  for (let i = right.length - 1; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
  c.closePath();
}

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  return g ? [c, g] : null;
}

/** The seal and the moon in the home page hero. The moon turns through its phases by itself (unless the
 *  reader prefers reduced motion); dragging, scrolling over it or the arrow keys turn it by hand. No background:
 *  the seal and the rings take the theme's ink colour, so they are black in the light theme and white in the
 *  dark one. The seal shows as soon as its image arrives; the canvas waits only for the moon. */
export function SealMoon() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nameRef = useRef<HTMLDivElement>(null);
  const litRef = useRef<HTMLSpanElement>(null);
  const [hintGone, setHintGone] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const nameEl = nameRef.current;
    const litEl = litRef.current;
    if (!canvas || !nameEl || !litEl) return;

    const turnsByItself = !reducedMotion();
    let resumeAt = 0; // while the reader is turning the moon, it does not also turn by itself
    let angle = START_ANGLE;
    let velocity = 0;
    let dragging = false;
    let dragMode: "angular" | "linear" = "angular";
    let lastPointerAngle = 0;
    let lastX = 0;
    let lastT = 0;
    let visible = true;
    let raf = 0;

    const touched = () => {
      setHintGone(true);
      resumeAt = performance.now() + RESUME_AFTER_MS;
    };

    // ---------- interaction ----------
    const toCanvas = (e: { clientX: number; clientY: number }) => {
      const b = canvas.getBoundingClientRect();
      return { x: ((e.clientX - b.left) * W) / b.width, y: ((e.clientY - b.top) * H) / b.height };
    };
    const onMoon = (pt: { x: number; y: number }) => Math.hypot(pt.x - MOON.x, pt.y - MOON.y) < MOON.r * 1.2;

    const onPointerDown = (e: PointerEvent) => {
      const pt = toCanvas(e);
      if (!onMoon(pt)) return;
      touched();
      dragging = true;
      velocity = 0;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      dragMode = Math.hypot(pt.x - MOON.x, pt.y - MOON.y) > MOON.r * 0.3 ? "angular" : "linear";
      lastPointerAngle = Math.atan2(pt.y - MOON.y, pt.x - MOON.x);
      lastX = pt.x;
      lastT = performance.now();
    };
    const onPointerMove = (e: PointerEvent) => {
      const pt = toCanvas(e);
      if (!dragging) {
        canvas.style.cursor = onMoon(pt) ? "grab" : "";
        return;
      }
      const now = performance.now();
      let delta: number;
      if (dragMode === "angular") {
        const a = Math.atan2(pt.y - MOON.y, pt.x - MOON.x);
        delta = a - lastPointerAngle;
        if (delta > Math.PI) delta -= TAU;
        if (delta < -Math.PI) delta += TAU;
        lastPointerAngle = a;
      } else {
        delta = (pt.x - lastX) / MOON.r;
        lastX = pt.x;
      }
      angle += delta;
      const dt = Math.max(1, now - lastT) / 1000;
      velocity = 0.7 * velocity + 0.3 * (delta / dt);
      lastT = now;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      resumeAt = performance.now() + RESUME_AFTER_MS;
      canvas.style.cursor = "grab";
      if (performance.now() - lastT > 80) velocity = 0; // let go after pausing: no fling
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // The capture is already gone.
      }
    };
    // A touch that starts on the moon turns it; anywhere else it scrolls the page as usual.
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t && onMoon(toCanvas(t))) e.preventDefault();
    };
    const onWheel = (e: WheelEvent) => {
      if (!onMoon(toCanvas(e))) return;
      e.preventDefault();
      touched();
      angle += (e.deltaY + e.deltaX) * 0.0025;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const step = ((e.shiftKey ? 30 : 5) * Math.PI) / 180;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") angle += step;
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") angle -= step;
      else return;
      e.preventDefault();
      touched();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKeyDown);

    // Off screen, the moon keeps turning but is not drawn.
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
          });
    io?.observe(canvas);

    // ---------- drawing ----------
    // Starts once the moon image has loaded, so nothing touches a canvas context before then.
    const moonImg = new Image();

    const start = () => {
      const ctx = canvas.getContext("2d");
      const shade = canvas2d(Math.ceil(MOON.r * 2 + 24), Math.ceil(MOON.r * 2 + 24));
      const hatchTile = canvas2d(8, 8);
      if (!ctx || !shade || !hatchTile) return;
      const [shadeCanvas, sctx] = shade;
      const S = shadeCanvas.width;

      // engraved hatch for the dark side
      const [tile, h] = hatchTile;
      h.strokeStyle = "rgba(15,18,15,0.55)";
      h.lineWidth = 1;
      h.beginPath();
      for (let i = -8; i <= 16; i += 8) {
        h.moveTo(i, 8);
        h.lineTo(i + 8, 0);
      }
      h.stroke();
      const hatch = ctx.createPattern(tile, "repeat");

      const style = getComputedStyle(canvas);
      let ink = "";
      let drawnAngle = NaN;

      const draw = (c: CanvasRenderingContext2D) => {
        const p = phaseOf(angle);
        const lit = illumination(p);
        const { x, y, r } = MOON;

        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalCompositeOperation = "source-over";
        c.globalAlpha = 1;
        c.clearRect(0, 0, W, H);

        // dashed orbit ring
        c.save();
        c.strokeStyle = ink;
        c.lineWidth = 2.6;
        c.setLineDash([16, 11]);
        c.beginPath();
        c.arc(x, y, r * 1.2, 0, TAU);
        c.stroke();
        c.restore();

        // soft moonlight glow, stronger as the moon fills
        const glow = c.createRadialGradient(x, y, r * 0.9, x, y, r * 1.16);
        glow.addColorStop(0, `rgba(255,255,252,${0.95 * lit})`);
        glow.addColorStop(1, "rgba(255,255,252,0)");
        c.fillStyle = glow;
        c.beginPath();
        c.arc(x, y, r * 1.16, 0, TAU);
        c.fill();

        // the moon itself, rotated
        c.save();
        c.beginPath();
        c.arc(x, y, r + 1.5, 0, TAU);
        c.clip();
        c.fillStyle = MOON_PAPER;
        c.fill();
        c.translate(x, y);
        c.rotate(angle);
        const s = MOON_SRC.size * (r / MOON_SRC.r);
        c.drawImage(moonImg, -s / 2, -s / 2, s, s);
        c.restore();

        // soft-edged dark side, then engraved hatching over it
        if (lit < 0.999) {
          const half = S / 2;
          sctx.setTransform(1, 0, 0, 1, 0, 0);
          sctx.clearRect(0, 0, S, S);
          sctx.filter = "blur(3.5px)";
          sctx.translate(half, half);
          shadowPath(sctx, p, r + 2);
          sctx.fillStyle = "#343934";
          sctx.fill();
          sctx.filter = "none";

          c.save();
          c.beginPath();
          c.arc(x, y, r + 1.5, 0, TAU);
          c.clip();
          c.globalCompositeOperation = "multiply";
          c.globalAlpha = 0.88;
          c.drawImage(shadeCanvas, x - half, y - half);
          c.globalAlpha = 1;
          c.globalCompositeOperation = "source-over";
          c.translate(x, y);
          shadowPath(c, p, r + 2);
          c.clip();
          if (hatch) {
            c.fillStyle = hatch;
            c.globalAlpha = 0.55;
            c.fillRect(-r - 4, -r - 4, 2 * r + 8, 2 * r + 8);
          }
          c.restore();
        }

        // crisp rim
        c.globalAlpha = 1;
        c.globalCompositeOperation = "source-over";
        c.strokeStyle = ink;
        c.lineWidth = 3;
        c.beginPath();
        c.arc(x, y, r, 0, TAU);
        c.stroke();
      };

      const label = () => {
        const p = phaseOf(angle);
        const name = phaseName(p);
        const lit = litText(p);
        const deg = degrees(angle);
        if (nameEl.textContent !== name) nameEl.textContent = name;
        if (litEl.textContent !== lit) litEl.textContent = lit;
        canvas.setAttribute("aria-valuenow", String(Math.round(deg)));
        canvas.setAttribute("aria-valuetext", `${name}, ${lit}`);
      };

      let prev = 0;
      const frame = (now: number) => {
        const dt = Math.min(0.05, (now - prev) / 1000);
        prev = now;
        if (!dragging) {
          if (Math.abs(velocity) > 0.01) {
            angle += velocity * dt;
            velocity *= Math.pow(0.04, dt); // friction
          } else velocity = 0;
          if (turnsByItself && now >= resumeAt) angle += (TAU / CYCLE_SECONDS) * dt;
        }
        if (visible) {
          // The theme sets the ink of the rings: redraw when it changes.
          if (style.color !== ink) {
            ink = style.color;
            drawnAngle = NaN;
          }
          if (angle !== drawnAngle) {
            draw(ctx);
            label();
            drawnAngle = angle;
          }
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame((t) => {
        prev = t;
        frame(t);
      });
    };

    moonImg.onload = start;
    moonImg.src = MOON_URL;

    return () => {
      cancelAnimationFrame(raf);
      moonImg.onload = null;
      io?.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Text for the starting angle; the animation keeps it up to date from then on.
  const p0 = phaseOf(START_ANGLE);
  const deg0 = Math.round(degrees(START_ANGLE));
  return (
    <div className="seal-moon">
      <div className="seal-moon-stage">
        <span className="seal-moon-seal" aria-hidden="true" />
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          tabIndex={0}
          role="slider"
          aria-label="Moon. Drag, scroll or use the arrow keys to turn it and change its phase."
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={deg0}
          aria-valuetext={`${phaseName(p0)}, ${litText(p0)}`}
        />
        <MoonWeb />
      </div>
      <div className="seal-moon-phase">
        <div className="seal-moon-name" ref={nameRef}>
          {phaseName(p0)}
        </div>
        <div className="seal-moon-lit">
          <span ref={litRef}>{litText(p0)}</span>
          {!hintGone && <span> · drag the moon to turn it</span>}
        </div>
      </div>
    </div>
  );
}

/** Where a line from p towards q leaves p: the edge of p's box, or the moon's orbit ring. */
function exitPoint(p: WebPoint, q: WebPoint): [number, number] {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const t = p.label === undefined ? p.half / Math.hypot(dx, dy) : p.half / Math.max(Math.abs(dx), Math.abs(dy));
  return [p.x + dx * t, p.y + dy * t];
}

// Springs for the network, in stage units and seconds. Each box is held to its place by an anchor spring and
// to its neighbours by the lines; boxes pushed closer than they rest repel each other. The moon never moves.
const K_ANCHOR = 60;
const K_EDGE = 50;
const K_REPEL = 80;
const REPEL_RANGE = 200;
const MAX_FLING = 3000;
// Four boxes move on their own, each on its own loop and at its own pace; every other box only reacts, pulled
// by the lines. Amplitudes in stage units (2.5 = 1px), periods in seconds, phases in radians. Peak speeds run
// from about 31px/s (g) down to 14px/s (j).
const WEB_MOVERS: Record<string, { ax: number; ay: number; period: number; phase: number }> = {
  g: { ax: 80, ay: 45, period: 6.5, phase: 1 },
  b: { ax: 100, ay: 55, period: 10, phase: 0 },
  e: { ax: 55, ay: 95, period: 15, phase: 2 },
  j: { ax: 75, ay: 115, period: 21, phase: 4 },
};
const READOUT_MS = 120; // numbers update at most this often while floating, so they read calmly

// hx, hy: home. rx, ry: where the anchor spring pulls now (home, or home plus drift).
type WebNode = WebPoint & {
  id: string;
  hx: number;
  hy: number;
  rx: number;
  ry: number;
  vx: number;
  vy: number;
  fx: number;
  fy: number;
};

/** Numbered boxes joined by dashed lines through the moon, in the theme's line colours. Four boxes move on
 *  their own and the rest react through the lines. A box can be dragged: the boxes joined to it follow, nearby
 *  ones are pushed aside, each number follows its box's distance to the moon, and on release everything
 *  springs back. */
function MoonWeb() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const nodes: WebNode[] = Object.entries(WEB_POINTS).map(([id, p]) => ({
      ...p, id, hx: p.x, hy: p.y, rx: p.x, ry: p.y, vx: 0, vy: 0, fx: 0, fy: 0,
    }));
    const drifters = nodes.flatMap((n) => (WEB_MOVERS[n.id] ? [{ n, ...WEB_MOVERS[n.id] }] : []));
    // No drift for readers who prefer reduced motion, nor while the network is off screen or hidden.
    const drifts = !reducedMotion() && drifters.length > 0;
    let visible = false;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const groups = new Map(
      [...svg.querySelectorAll<SVGGElement>("g[data-node]")].map((g) => [g.dataset.node ?? "", g]),
    );
    const lines = [...svg.querySelectorAll<SVGLineElement>("line[data-edge]")];
    // A box's number scales with its distance to the moon: its base value at home, more when farther.
    // The text node React rendered is edited in place, so React's copy never goes stale.
    const moon = byId.get("moon");
    const readouts = nodes.flatMap((n) => {
      const text = groups.get(n.id)?.querySelector("text")?.firstChild;
      return moon && n.label !== undefined && text
        ? [{ n, text, value: parseFloat(n.label), home: Math.hypot(n.rx - moon.rx, n.ry - moon.ry) }]
        : [];
    });
    const edges = WEB_EDGES.flatMap(([a, b], k) => {
      const p = byId.get(a);
      const q = byId.get(b);
      const el = lines[k];
      return p && q && el ? [{ p, q, el, len: Math.hypot(q.rx - p.rx, q.ry - p.ry) }] : [];
    });
    const pairs = nodes.flatMap((p, i) =>
      nodes.slice(i + 1).map((q) => ({ p, q, near: Math.min(REPEL_RANGE, 0.9 * Math.hypot(q.rx - p.rx, q.ry - p.ry)) })),
    );
    const fixed = (n: WebNode) => n.label === undefined;
    // Bouncy by default; without the bounce for readers who prefer reduced motion.
    const damping = 2 * (reducedMotion() ? 1 : 0.45) * Math.sqrt(K_ANCHOR);

    let drag: { node: WebNode; pointerId: number; dx: number; dy: number; vx: number; vy: number; t: number } | null =
      null;
    let raf = 0;
    let last = 0;

    const step = (dt: number) => {
      for (const n of nodes) {
        n.fx = -K_ANCHOR * (n.x - n.rx) - damping * n.vx;
        n.fy = -K_ANCHOR * (n.y - n.ry) - damping * n.vy;
      }
      for (const { p, q, len } of edges) {
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const f = (K_EDGE * (d - len)) / d;
        p.fx += f * dx;
        p.fy += f * dy;
        q.fx -= f * dx;
        q.fy -= f * dy;
      }
      for (const { p, q, near } of pairs) {
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d >= near) continue;
        const f = (K_REPEL * (near - d)) / d;
        p.fx -= f * dx;
        p.fy -= f * dy;
        q.fx += f * dx;
        q.fy += f * dy;
      }
      for (const n of nodes) {
        if (fixed(n) || n === drag?.node) continue;
        n.vx += n.fx * dt;
        n.vy += n.fy * dt;
        n.x += n.vx * dt;
        n.y += n.vy * dt;
      }
    };

    let lastReadout = 0;
    const render = (final = false) => {
      for (const n of nodes) groups.get(n.id)?.setAttribute("transform", `translate(${n.x} ${n.y})`);
      for (const { p, q, el } of edges) {
        const [x1, y1] = exitPoint(p, q);
        const [x2, y2] = exitPoint(q, p);
        el.setAttribute("x1", String(x1));
        el.setAttribute("y1", String(y1));
        el.setAttribute("x2", String(x2));
        el.setAttribute("y2", String(y2));
      }
      const now = performance.now();
      if (moon && (final || now - lastReadout >= READOUT_MS)) {
        lastReadout = now;
        for (const { n, text, value, home } of readouts) {
          const shown = ((value * Math.hypot(n.x - moon.x, n.y - moon.y)) / home).toFixed(4);
          if (text.nodeValue !== shown) text.nodeValue = shown;
        }
      }
    };

    const settled = () =>
      // Within half a pixel of home and barely moving (2.5 units = 1px).
      nodes.every((n) => Math.abs(n.x - n.rx) < 1 && Math.abs(n.y - n.ry) < 1 && Math.hypot(n.vx, n.vy) < 5);

    const tick = (now: number) => {
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      const drifting = drifts && visible;
      if (drifting) {
        // Two slow waves per axis at unrelated rates, so no path repeats like clockwork.
        for (const { n, ax, ay, period, phase } of drifters) {
          const w = (TAU * now) / 1000 / period + phase;
          n.rx = n.hx + ax * (0.8 * Math.sin(w) + 0.2 * Math.sin(2.3 * w + 1.1));
          n.ry = n.hy + ay * (0.8 * Math.sin(0.77 * w + 1) + 0.2 * Math.sin(1.9 * w + 2.4));
        }
      }
      for (let i = 0; i < 4; i++) step(dt / 4);
      if (!drag && !drifting && settled()) {
        for (const n of nodes) {
          n.x = n.rx;
          n.y = n.ry;
          n.vx = n.vy = 0;
        }
        render(true);
        raf = 0;
        return;
      }
      render();
      raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const toUnits = (e: PointerEvent) => {
      const b = svg.getBoundingClientRect();
      return { x: ((e.clientX - b.left) * 1000) / b.width, y: ((e.clientY - b.top) * STAGE_UNITS_H) / b.height };
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const group = target?.closest<SVGGElement>("g[data-node]");
      const node = group && byId.get(group.dataset.node ?? "");
      if (!target || !group || !node || drag) return;
      const pt = toUnits(e);
      drag = { node, pointerId: e.pointerId, dx: node.x - pt.x, dy: node.y - pt.y, vx: 0, vy: 0, t: performance.now() };
      node.vx = node.vy = 0;
      target.setPointerCapture(e.pointerId);
      group.dataset.active = "";
      e.preventDefault();
      wake();
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const { node } = drag;
      const pt = toUnits(e);
      const now = performance.now();
      const dt = Math.max(1, now - drag.t) / 1000;
      const x = pt.x + drag.dx;
      const y = pt.y + drag.dy;
      drag.vx = 0.7 * drag.vx + (0.3 * (x - node.x)) / dt;
      drag.vy = 0.7 * drag.vy + (0.3 * (y - node.y)) / dt;
      drag.t = now;
      node.x = x;
      node.y = y;
      wake();
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const { node, vx, vy } = drag;
      const speed = Math.hypot(vx, vy);
      const scale = speed > MAX_FLING ? MAX_FLING / speed : 1;
      node.vx = vx * scale;
      node.vy = vy * scale;
      delete groups.get(node.id)?.dataset.active;
      drag = null;
      wake();
    };

    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible && drifts) wake();
          });
    io?.observe(svg);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const boxes = Object.entries(WEB_POINTS).filter(([, p]) => p.label !== undefined);
  return (
    <svg
      ref={svgRef}
      className="seal-moon-web"
      viewBox={`0 0 1000 ${STAGE_UNITS_H}`}
      aria-hidden="true"
      focusable="false"
    >
      {WEB_EDGES.map(([a, b]) => {
        const [x1, y1] = exitPoint(WEB_POINTS[a], WEB_POINTS[b]);
        const [x2, y2] = exitPoint(WEB_POINTS[b], WEB_POINTS[a]);
        return <line key={`${a}-${b}`} data-edge="" x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
      {boxes.map(([key, p]) => (
        <g key={key} data-node={key} transform={`translate(${p.x} ${p.y})`}>
          <rect x={-p.half} y={-p.half} width={2 * p.half} height={2 * p.half} />
          <text x={0} y={0}>
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
