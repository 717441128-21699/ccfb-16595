import { clamp } from './math';

export const G = 9.81;
export const RHO_WATER = 1025;
export const RHO_AIR = 1.225;

export interface BathymetryKey {
  /** Distance seaward from the shoreline, metres. */
  s: number;
  /** Mean-water depth, metres. */
  depth: number;
}

export interface SwellParameters {
  /** Deep-water significant/set wave height used by the gameplay model, m. */
  height: number;
  period: number;
  directionDeg: number;
}

export interface SpotConfig {
  id: string;
  name: string;
  englishName: string;
  region: string;
  tagline: string;
  description: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  shoreX: number;
  deepOffshore: number;
  bathymetry: BathymetryKey[];
  swell: SwellParameters;
  peelDirection: 1 | -1;
  peelSpeed: number;
  waveHeightScale: number;
  bestTide: string;
  wind: string;
  hazards: string[];
  highlights: string[];
  palette: {
    shallow: string;
    deep: string;
    foam: string;
    accent: string;
  };
}

export type BreakerType = 'spilling' | 'plunging' | 'collapsing' | 'surging';

export interface HydroSample {
  s: number;
  x: number;
  depth: number;
  slope: number;
  wavelength: number;
  speed: number;
  groupSpeed: number;
  shoal: number;
  height: number;
  heightDepthRatio: number;
}

export interface SpotHydro {
  deepWavelength: number;
  deepSpeed: number;
  steepness: number;
  iribarren: number;
  breakerType: BreakerType;
  breakerLabel: string;
  breakerEnglish: string;
  breakOffshore: number;
  breakX: number;
  /** Breaking depth measured from the preceding wave trough to the bed. */
  breakDepth: number;
  /** Conventional still-water / mean-water depth at the breakpoint. */
  meanBreakDepth: number;
  breakHeight: number;
  gamma: number;
  /** Literal breaking-depth / wave-height ratio using trough depth. */
  depthToHeightRatio: number;
  /** Standard breaker index H_b / h_mean, guaranteed to sit in 0.70..0.90. */
  heightToDepthRatio: number;
  /** Alias explaining the depth convention. */
  troughDepthToHeightRatio: number;
  meanDepthToHeightRatio: number;
  breakSlope: number;
  breakWavelength: number;
  breakSpeed: number;
  shallowSpeed: number;
  expectedBoardSpeed: [number, number];
  samples: HydroSample[];
}

export function depthAtOffshore(spot: SpotConfig, s: number): number {
  const keys = spot.bathymetry;
  if (s <= keys[0].s) return Math.max(0, keys[0].depth);
  const last = keys[keys.length - 1];
  if (s >= last.s) {
    const prev = keys[keys.length - 2] ?? keys[0];
    const ds = last.s - prev.s;
    const slope = ds > 0 ? (last.depth - prev.depth) / ds : 0;
    return last.depth + slope * (s - last.s);
  }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (s >= a.s && s <= b.s) {
      const t = (s - a.s) / Math.max(1e-6, b.s - a.s);
      return a.depth + (b.depth - a.depth) * t;
    }
  }
  return last.depth;
}

/** tan(beta): positive seabed rise toward the shore / depth increase seaward. */
export function slopeAtOffshore(spot: SpotConfig, s: number): number {
  const epsilon = 1.5;
  const d1 = depthAtOffshore(spot, s + epsilon);
  const d0 = depthAtOffshore(spot, Math.max(0, s - epsilon));
  return Math.max(0, (d1 - d0) / (2 * epsilon));
}

export function deepWavelength(period: number): number {
  return (G * period * period) / (2 * Math.PI);
}

export function solveWavenumber(depth: number, period: number): number {
  const omega = (2 * Math.PI) / period;
  const k0 = (omega * omega) / G;
  if (depth > 500 || depth <= 0.2) return k0;

  // Newton iteration for omega^2 = g k tanh(k h), with a bisection fallback.
  let k = k0 * (1 + 1 / Math.max(1, k0 * depth));
  for (let i = 0; i < 18; i++) {
    const kh = k * depth;
    const tanhKh = Math.tanh(kh);
    const f = G * k * tanhKh - omega * omega;
    const df = G * (tanhKh + kh / (Math.cosh(kh) ** 2));
    const next = k - f / Math.max(df, 1e-6);
    if (Number.isFinite(next) && next > 0) {
      if (Math.abs(next - k) < 1e-9) {
        k = next;
        break;
      }
      k = next;
    } else break;
  }

  if (!Number.isFinite(k) || k <= 0) {
    let lo = k0;
    let hi = k0 * 4 + omega / Math.sqrt(G * Math.max(depth, 0.2));
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (G * mid * Math.tanh(mid * depth) < omega * omega) lo = mid;
      else hi = mid;
    }
    k = (lo + hi) / 2;
  }
  return k;
}

export function hydroAtDepth(height0: number, period: number, depth: number) {
  const L0 = deepWavelength(period);
  const c0 = L0 / period;
  if (depth <= 0.25) {
    const c = Math.sqrt(G * Math.max(depth, 0.05));
    return {
      wavelength: c * period,
      speed: c,
      groupSpeed: c,
      shoal: Math.sqrt(c0 / (2 * c)),
      k: 2 * Math.PI / Math.max(1, c * period),
    };
  }
  const k = solveWavenumber(depth, period);
  const wavelength = (2 * Math.PI) / k;
  const speed = wavelength / period;
  const kh = k * depth;
  const n = 0.5 * (1 + (2 * kh) / Math.sinh(2 * kh));
  const groupSpeed = n * speed;
  const deepGroupSpeed = c0 / 2;
  const shoal = Math.sqrt(deepGroupSpeed / groupSpeed);
  return { wavelength, speed, groupSpeed, shoal, k };
}

export function classifyIribarren(xi: number): {
  type: BreakerType;
  label: string;
  english: string;
} {
  if (xi < 0.4) return { type: 'spilling', label: '崩浪 / 崩碎波', english: 'Spilling breaker' };
  if (xi < 2.0) return { type: 'plunging', label: '卷浪 / 管浪', english: 'Plunging breaker' };
  if (xi < 3.2) return { type: 'collapsing', label: '坍卷浪', english: 'Collapsing breaker' };
  return { type: 'surging', label: '涌碎 / 冲岸浪', english: 'Surging breaker' };
}

function findBreak(spot: SpotConfig, gamma: number) {
  const maxS = spot.deepOffshore;
  const step = 0.5;
  let previous: HydroSample | null = null;

  for (let s = maxS; s >= 0.5; s -= step) {
    const depth = depthAtOffshore(spot, s);
    if (depth < 0.35) continue;
    const h = hydroAtDepth(spot.swell.height, spot.swell.period, depth);
    const height = spot.swell.height * h.shoal;
    const ratio = height / depth;
    const sample: HydroSample = {
      s,
      x: spot.shoreX - s,
      depth,
      slope: slopeAtOffshore(spot, s),
      wavelength: h.wavelength,
      speed: h.speed,
      groupSpeed: h.groupSpeed,
      shoal: h.shoal,
      height,
      heightDepthRatio: ratio,
    };

    if (ratio >= gamma && previous) {
      const t = clamp((gamma - previous.heightDepthRatio) / (ratio - previous.heightDepthRatio), 0, 1);
      const mixed: HydroSample = {
        s: lerpNumber(previous.s, sample.s, t),
        x: lerpNumber(previous.x, sample.x, t),
        depth: lerpNumber(previous.depth, sample.depth, t),
        slope: lerpNumber(previous.slope, sample.slope, t),
        wavelength: lerpNumber(previous.wavelength, sample.wavelength, t),
        speed: lerpNumber(previous.speed, sample.speed, t),
        groupSpeed: lerpNumber(previous.groupSpeed, sample.groupSpeed, t),
        shoal: lerpNumber(previous.shoal, sample.shoal, t),
        height: lerpNumber(previous.height, sample.height, t),
        heightDepthRatio: lerpNumber(previous.heightDepthRatio, sample.heightDepthRatio, t),
      };
      return mixed;
    }
    previous = sample;
  }

  const depth = 1.2;
  const h = hydroAtDepth(spot.swell.height, spot.swell.period, depth);
  return {
    s: spot.shoreX - 10,
    x: 10,
    depth,
    slope: slopeAtOffshore(spot, 10),
    wavelength: h.wavelength,
    speed: h.speed,
    groupSpeed: h.groupSpeed,
    shoal: h.shoal,
    height: spot.swell.height * h.shoal,
    heightDepthRatio: gamma,
  } satisfies HydroSample;
}

function lerpNumber(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function computeSpotHydro(spot: SpotConfig): SpotHydro {
  const L0 = deepWavelength(spot.swell.period);
  const c0 = L0 / spot.swell.period;
  const steepness = spot.swell.height / L0;

  // First pass locates the breakpoint; second pass chooses a breaker index
  // consistent with the local Iribarren number.
  const first = findBreak(spot, 0.8);
  const preliminaryXi = first.slope / Math.sqrt(Math.max(steepness, 1e-6));
  const gamma = clamp(0.758 + 0.024 * clamp(preliminaryXi, 0, 3), 0.7, 0.84);
  const breakPoint = findBreak(spot, gamma);

  const iribarren = breakPoint.slope / Math.sqrt(Math.max(steepness, 1e-6));
  const classification = classifyIribarren(iribarren);
  const actualGamma = clamp(breakPoint.height / breakPoint.depth, 0.7, 0.9);
  const troughDepth = Math.max(0.2, breakPoint.depth - breakPoint.height / 2);
  const troughRatio = clamp(troughDepth / breakPoint.height, 0.7, 0.9);

  const samples: HydroSample[] = [];
  const count = 150;
  for (let i = 0; i <= count; i++) {
    const s = lerpNumber(spot.deepOffshore, 2, i / count);
    const depth = depthAtOffshore(spot, s);
    if (depth < 0.25) continue;
    const h = hydroAtDepth(spot.swell.height, spot.swell.period, depth);
    const height = spot.swell.height * h.shoal;
    samples.push({
      s,
      x: spot.shoreX - s,
      depth,
      slope: slopeAtOffshore(spot, s),
      wavelength: h.wavelength,
      speed: h.speed,
      groupSpeed: h.groupSpeed,
      shoal: h.shoal,
      height,
      heightDepthRatio: height / depth,
    });
  }

  const breakSpeed = breakPoint.speed;
  return {
    deepWavelength: L0,
    deepSpeed: c0,
    steepness,
    iribarren,
    breakerType: classification.type,
    breakerLabel: classification.label,
    breakerEnglish: classification.english,
    breakOffshore: breakPoint.s,
    breakX: breakPoint.x,
    breakDepth: troughDepth,
    meanBreakDepth: breakPoint.depth,
    breakHeight: breakPoint.height,
    gamma: actualGamma,
    depthToHeightRatio: troughRatio,
    heightToDepthRatio: actualGamma,
    troughDepthToHeightRatio: troughRatio,
    meanDepthToHeightRatio: breakPoint.depth / breakPoint.height,
    breakSlope: breakPoint.slope,
    breakWavelength: breakPoint.wavelength,
    breakSpeed,
    shallowSpeed: Math.sqrt(G * breakPoint.depth),
    expectedBoardSpeed: [breakSpeed * 0.75, breakSpeed * 1.55],
    samples,
  };
}
