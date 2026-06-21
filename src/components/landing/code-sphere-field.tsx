"use client";

import { useEffect, useRef } from "react";

/**
 * CodeSphereField — an ambient, dark-mode background of slowly rotating
 * "spheres of code". Each sphere is a cloud of monospace glyphs distributed on
 * a sphere surface (Fibonacci/golden-spiral), rotated in 3D and projected to 2D
 * with perspective + depth fog. Near glyphs are crisp and azure-tinted; far
 * glyphs dim and dissolve into the background — reading as genuine depth.
 *
 * The glyphs are product-meaningful: the coded slang, vector/score and hex
 * fragments Narcore actually parses, so the motion represents the detection
 * corpus rather than decorative noise.
 *
 * Rendering is Canvas 2D — dependency-free and fast. The component is a leaf
 * with a small prop contract (`intensity`), so a WebGL/Three.js renderer could
 * later implement the same contract without touching the page.
 */

type Intensity = "subtle" | "medium" | "bold";

interface CodeSphereFieldProps {
  className?: string;
  /** Scales glyph density, opacity and rotation speed. Default "subtle". */
  intensity?: Intensity;
}

/** The corpus made visible — coded slang, vector/score/hex fragments, symbols. */
const GLYPHS = [
  "M30", "perc", "blues", "30s", "beans", "zans", "addy", "tabs", "plug", "drop",
  "0x7f", "0xae", "0x1c", "v[256]", "v[768]", "0.91", "0.88", "0.73", "sig:hi", "cos≈",
  "∑", "⌖", "▲", "◆", "⌁", "≈", "→",
  "CashApp", "tg://", "encrypted", "dm", "trap", "re-up",
  "01", "10", "1101", "ff", "a3", "7c", "e0", "b9", "d4",
] as const;

interface SphereSpec {
  /** Center as a fraction of the canvas (0..1). */
  cx: number;
  cy: number;
  /** Radius as a fraction of the smaller canvas dimension. */
  radius: number;
  /** Rotation-speed multiplier and direction. */
  speedK: number;
  dir: 1 | -1;
  /** Fixed axis tilt (radians), pre-baked into the base coordinates. */
  tilt: number;
  /** Index into the intensity `counts` array for glyph density. */
  countIndex: 0 | 1 | 2;
}

/** Three spheres at different depths/positions for parallax. Main is centered. */
const SPHERES: readonly SphereSpec[] = [
  { cx: 0.5, cy: 0.44, radius: 0.46, speedK: 1.0, dir: 1, tilt: 0.5, countIndex: 0 },
  { cx: 0.16, cy: 0.27, radius: 0.2, speedK: 1.7, dir: -1, tilt: -0.35, countIndex: 1 },
  { cx: 0.84, cy: 0.78, radius: 0.26, speedK: 1.3, dir: 1, tilt: 0.7, countIndex: 2 },
] as const;

interface IntensityConfig {
  /** Base opacity multiplier for the whole field. */
  opacity: number;
  /** Base rotation speed in radians/second. */
  speed: number;
  /** Glyph counts per sphere (indexed by SphereSpec.countIndex). */
  counts: readonly [number, number, number];
}

const INTENSITY: Record<Intensity, IntensityConfig> = {
  subtle: { opacity: 0.5, speed: 0.085, counts: [120, 60, 44] },
  medium: { opacity: 0.7, speed: 0.12, counts: [165, 92, 62] },
  bold: { opacity: 0.92, speed: 0.16, counts: [230, 130, 90] },
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Camera distance for perspective division; larger = flatter. */
const CAMERA_Z = 2.6;

interface Glyph {
  /** Base coordinates on the unit sphere (tilt pre-applied), |.| = 1. */
  bx: number;
  by: number;
  bz: number;
  char: string;
}

interface Sphere {
  spec: SphereSpec;
  glyphs: Glyph[];
  /** Current rotation angle around the Y axis. */
  phase: number;
}

interface Palette {
  near: string;
  mid: string;
  far: string;
}

function pickGlyph(): string {
  return GLYPHS[(Math.random() * GLYPHS.length) | 0];
}

/** Distribute `count` glyphs on a unit sphere, pre-applying the axis tilt. */
function buildGlyphs(count: number, tilt: number): Glyph[] {
  const sinT = Math.sin(tilt);
  const cosT = Math.cos(tilt);
  const glyphs: Glyph[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const y = count === 1 ? 0 : 1 - (i / (count - 1)) * 2; // 1 → -1
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * GOLDEN_ANGLE;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    // Tilt around the X axis once, so the per-frame loop only spins around Y.
    const ty = y * cosT - z * sinT;
    const tz = y * sinT + z * cosT;
    glyphs[i] = { bx: x, by: ty, bz: tz, char: pickGlyph() };
  }
  return glyphs;
}

function resolveToken(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = styles.getPropertyValue(name).trim();
  return v.length > 0 ? v : fallback;
}

export function CodeSphereField({ className, intensity = "subtle" }: CodeSphereFieldProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const config = INTENSITY[intensity];

    // Density scales down on small / coarse-pointer devices for performance.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const small = window.matchMedia("(max-width: 640px)").matches;
    const densityK = small ? 0.45 : coarse ? 0.7 : 1;

    const spheres: Sphere[] = SPHERES.map((spec) => ({
      spec,
      phase: Math.random() * Math.PI * 2,
      glyphs: buildGlyphs(
        Math.max(8, Math.round(config.counts[spec.countIndex] * densityK)),
        spec.tilt,
      ),
    }));

    // Colors are read from design tokens so the field tracks the theme.
    let palette: Palette = { near: "#5b8cff", mid: "#d8dde6", far: "#7c8392" };
    let fontFamily = "ui-monospace, monospace";
    const readTokens = () => {
      const styles = getComputedStyle(document.documentElement);
      palette = {
        near: resolveToken(styles, "--primary", palette.near),
        mid: resolveToken(styles, "--foreground", palette.mid),
        far: resolveToken(styles, "--muted-foreground", palette.far),
      };
      fontFamily = resolveToken(styles, "--font-mono", fontFamily);
    };
    readTokens();

    let cssW = 0;
    let cssH = 0;
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = wrap.getBoundingClientRect();
      cssW = Math.max(1, rect.width);
      cssH = Math.max(1, rect.height);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
    };

    const draw = () => {
      ctx.clearRect(0, 0, cssW, cssH);
      const minDim = Math.min(cssW, cssH);

      // Spheres drawn back-to-front: large centered backdrop first.
      for (const sphere of spheres) {
        const { spec } = sphere;
        const centerX = spec.cx * cssW;
        const centerY = spec.cy * cssH;
        const radiusPx = spec.radius * minDim;
        const baseFont = Math.max(9, radiusPx * 0.045);
        const sin = Math.sin(sphere.phase);
        const cos = Math.cos(sphere.phase);

        // Painter's algorithm: far glyphs first so near ones occlude them.
        const sorted = sphere.glyphs
          .map((g) => {
            // Spin the (already-tilted) base coords around the Y axis.
            const z = g.bx * sin + g.bz * cos;
            const x = g.bx * cos - g.bz * sin;
            return { g, x, y: g.by, z };
          })
          .sort((a, b) => a.z - b.z);

        for (const p of sorted) {
          const scale = CAMERA_Z / (CAMERA_Z - p.z); // perspective division
          const sx = centerX + p.x * radiusPx * scale;
          const sy = centerY + p.y * radiusPx * scale;
          // Depth fog: map z ∈ [-1,1] → alpha. Far side dissolves out.
          const depth = (p.z + 1) * 0.5; // 0 (far) → 1 (near)
          const alpha = (0.08 + depth * 0.92) * config.opacity;
          const color = p.z > 0.3 ? palette.near : p.z < -0.3 ? palette.far : palette.mid;

          ctx.globalAlpha = alpha;
          ctx.fillStyle = color;
          ctx.font = `${Math.round(baseFont * scale)}px ${fontFamily}`;
          ctx.fillText(p.g.char, sx, sy);
        }
      }
      ctx.globalAlpha = 1;
    };

    // --- Motion control: respect reduced-motion + pause when tab hidden. ---
    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let rafId = 0;
    let last = 0;
    let scrambleAcc = 0;
    let running = false;

    const scramble = () => {
      for (const sphere of spheres) {
        const flips = Math.max(1, (sphere.glyphs.length * 0.02) | 0);
        for (let i = 0; i < flips; i++) {
          sphere.glyphs[(Math.random() * sphere.glyphs.length) | 0].char = pickGlyph();
        }
      }
    };

    const frame = (t: number) => {
      const dt = last ? Math.min((t - last) / 1000, 0.05) : 0;
      last = t;
      for (const sphere of spheres) {
        sphere.phase += config.speed * sphere.spec.speedK * sphere.spec.dir * dt;
      }
      scrambleAcc += dt;
      if (scrambleAcc > 0.2) {
        scrambleAcc = 0;
        scramble();
      }
      draw();
      rafId = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running || reduceMq.matches || document.hidden) return;
      running = true;
      last = 0;
      rafId = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    const onReduceChange = () => {
      stop();
      draw(); // settle on a static frame
      start();
    };

    // --- Wiring ---
    fit();
    draw();
    start();

    const ro = new ResizeObserver(() => {
      fit();
      if (!running) draw();
    });
    ro.observe(wrap);

    // Keep colors in sync if the theme class on <html> ever changes.
    const themeObserver = new MutationObserver(() => {
      readTokens();
      if (!running) draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    document.addEventListener("visibilitychange", onVisibility);
    reduceMq.addEventListener("change", onReduceChange);

    return () => {
      stop();
      ro.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reduceMq.removeEventListener("change", onReduceChange);
    };
  }, [intensity]);

  return (
    <div
      ref={wrapRef}
      aria-hidden
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        // Fade edges into the dark and dim the center so hero copy stays legible.
        maskImage:
          "radial-gradient(120% 95% at 50% 42%, rgba(0,0,0,0.14) 0%, rgba(0,0,0,0.14) 20%, #000 46%, #000 64%, transparent 100%)",
        WebkitMaskImage:
          "radial-gradient(120% 95% at 50% 42%, rgba(0,0,0,0.14) 0%, rgba(0,0,0,0.14) 20%, #000 46%, #000 64%, transparent 100%)",
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
