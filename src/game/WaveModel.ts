import { computeSpotHydro, depthAtOffshore, type SpotConfig, type SpotHydro } from './hydrodynamics';
import { clamp, normalize, smoothstep, type Vec3, v3 } from './math';

export interface SectionState {
  along: number;
  age: number;
  behindFront: number;
  approach: number;
  curl: number;
  foam: number;
  broken: number;
  typeFactor: number;
}

export interface LipInfo {
  points: { x: number; y: number }[];
  clearance: number;
  nearestX: number;
  nearestY: number;
  active: boolean;
}

export interface SurfaceSample {
  height: number;
  normal: Vec3;
  slopeX: number;
  slopeZ: number;
  flow: Vec3;
  depth: number;
  crestX: number;
  toeX: number;
  u: number;
  faceHeight: number;
  waveHeight: number;
  along: number;
  peelZ: number;
  section: SectionState;
  lip: LipInfo;
  inPocket: boolean;
  inTube: boolean;
  zone: 'back' | 'crest' | 'pocket' | 'face' | 'front' | 'flat';
}

const START_ALONG = -96;
const END_ALONG = 108;

export class WaveModel {
  readonly hydro: SpotHydro;
  readonly peelDirection: 1 | -1;
  time = 0;

  constructor(readonly spot: SpotConfig) {
    this.hydro = computeSpotHydro(spot);
    this.peelDirection = spot.peelDirection;
  }

  reset() {
    // Place the peel front about five metres behind the player's alongshore station.
    this.time = 43 / this.spot.peelSpeed;
  }

  update(dt: number) {
    this.time += dt;
  }

  get peelAlong(): number {
    return START_ALONG + this.spot.peelSpeed * this.time;
  }

  get peelZ(): number {
    return this.peelDirection * this.peelAlong;
  }

  alongFromZ(z: number): number {
    return this.peelDirection * z;
  }

  zFromAlong(a: number): number {
    return this.peelDirection * a;
  }

  playerStart(): Vec3 {
    const along = -58;
    const z = this.zFromAlong(along);
    const crestX = this.crestXAt(z);
    const x = crestX + 3.8;
    const y = this.heightAt(x, z);
    return v3(x, y + 0.08, z);
  }

  initialYaw(): number {
    // Heading mostly along the peel, with a small shoreward/down-face angle.
    return this.peelDirection === 1 ? Math.PI / 2 - 0.3 : -Math.PI / 2 + 0.3;
  }

  crestXAt(z: number): number {
    return this.hydro.breakX - 2.1 + 2.1 * Math.sin(z * 0.021 + 0.7) + 0.8 * Math.sin(z * 0.061);
  }

  envelopeAtZ(z: number): number {
    const edge = smoothstep(-126, -108, z) * (1 - smoothstep(108, 126, z));
    const pulse = 0.94 + 0.06 * Math.sin(this.time * 0.52 + z * 0.035);
    return edge * pulse;
  }

  waveHeightAtZ(z: number): number {
    return Math.max(0.4, this.hydro.breakHeight * this.spot.waveHeightScale * this.envelopeAtZ(z));
  }

  toeWidthAtZ(z: number): number {
    const H = this.waveHeightAtZ(z);
    return 7.2 + H * 1.55;
  }

  sectionAtZ(z: number): SectionState {
    const along = this.alongFromZ(z);
    const front = this.peelAlong;
    const behindFront = front - along;
    const age = behindFront / this.spot.peelSpeed;

    let typeFactor = 0.85;
    let maxCurl = 0.9;
    let curlDecay = 4.8;
    if (this.hydro.breakerType === 'spilling') {
      typeFactor = 0.55;
      maxCurl = 0.2;
      curlDecay = 2.4;
    } else if (this.hydro.breakerType === 'plunging') {
      typeFactor = 1;
      maxCurl = 1;
      curlDecay = 5.2;
    } else if (this.hydro.breakerType === 'collapsing') {
      typeFactor = 1.12;
      maxCurl = 0.78;
      curlDecay = 2.7;
    } else {
      typeFactor = 0.8;
      maxCurl = 0.16;
      curlDecay = 2.0;
    }

    const birth = smoothstep(-1.8, 0.55, age);
    const decay = age < 0.8 ? 1 : Math.exp(-Math.max(0, age - 0.8) / curlDecay);
    const curl = maxCurl * birth * decay * this.envelopeAtZ(z);
    const foam = clamp(smoothstep(-0.2, 1.4, age) * (0.45 + 0.55 * decay), 0, 1);
    const broken = smoothstep(0.1, 2.2, age);
    const approach = 1 - smoothstep(-4.5, 0.2, behindFront);

    return { along, age, behindFront, approach, curl, foam, broken, typeFactor };
  }

  /** Pure wave elevation. This is the gameplay surface and must stay single-valued in x. */
  heightAt(x: number, z: number): number {
    const crestX = this.crestXAt(z);
    const width = this.toeWidthAtZ(z);
    const H = this.waveHeightAtZ(z);
    const u = (x - crestX) / width;

    let wall = 0;
    if (u < 0) {
      const back = clamp(1 + u * 0.58, 0, 1);
      wall = H * back * back * (0.98 + 0.02 * Math.cos(u * 4));
    } else if (u <= 1) {
      wall = H * Math.pow(1 - u, 1.52);
    } else {
      wall = 0;
    }

    const section = this.sectionAtZ(z);
    // Broken wave surface is chopped and slightly lowered.
    const chop =
      section.foam *
      (0.16 * Math.sin(x * 2.1 + this.time * 5.2 + z * 1.7) +
        0.09 * Math.sin(x * 4.7 - this.time * 7.1 + z * 2.3));
    const baseSwell =
      0.16 * Math.sin(x * 0.105 + this.time * 1.25) * Math.cos(z * 0.071 - this.time * 0.82) +
      0.055 * Math.sin(x * 0.31 - this.time * 2.1 + z * 0.19);

    // A small setup bump near the break bar.
    const setup = 0.18 * Math.exp(-Math.pow((x - crestX - width * 0.42) / (width * 0.5), 2));
    return baseSwell + setup + wall * (1 - 0.1 * section.broken) + chop;
  }

  seabedY(x: number, z: number): number {
    const s = this.spot.shoreX - x;
    if (s < 0) {
      // Dry beach rises above mean water landward of the nominal shoreline.
      const ripple = 0.05 * Math.sin(z * 0.13 + x * 0.05);
      return Math.min(7, -s * 0.09) + ripple;
    }
    const depth = depthAtOffshore(this.spot, s);
    const ripple = 0.12 * Math.sin(z * 0.11 + x * 0.045) + 0.06 * Math.sin(z * 0.31 - x * 0.08);
    return -depth + ripple;
  }

  normalAt(x: number, z: number): Vec3 {
    const e = 0.55;
    const hx1 = this.heightAt(x + e, z);
    const hx0 = this.heightAt(x - e, z);
    const hz1 = this.heightAt(x, z + e);
    const hz0 = this.heightAt(x, z - e);
    const dx = (hx1 - hx0) / (2 * e);
    const dz = (hz1 - hz0) / (2 * e);
    return { ...normalize(v3(-dx, 1, -dz)) };
  }

  lipPoints(z: number, segments = 22): { x: number; y: number }[] {
    const section = this.sectionAtZ(z);
    const curl = clamp(section.curl, 0, 1);
    const H = this.waveHeightAtZ(z);
    const x0 = this.crestXAt(z);

    const p0 = { x: x0 - 0.08 * H, y: H * 0.98 };
    const p1 = { x: x0 + 0.42 * H, y: H * 1.24 };
    const p2 = { x: x0 + (1.18 - 0.18 * curl) * H, y: H * (1.16 - 0.04 * curl) };
    const p3 = {
      x: x0 + (0.24 + 0.55 * curl) * H,
      y: H * (0.96 - 0.43 * curl),
    };

    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const it = 1 - t;
      const x =
        it * it * it * p0.x + 3 * it * it * t * p1.x + 3 * it * t * t * p2.x + t * t * t * p3.x;
      const y =
        it * it * it * p0.y + 3 * it * it * t * p1.y + 3 * it * t * t * p2.y + t * t * t * p3.y;
      points.push({ x, y });
    }
    return points;
  }

  sample(x: number, z: number): SurfaceSample {
    const height = this.heightAt(x, z);
    const normal = this.normalAt(x, z);
    const e = 0.7;
    const slopeX = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const slopeZ = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    const crestX = this.crestXAt(z);
    const toeX = crestX + this.toeWidthAtZ(z);
    const u = clamp((x - crestX) / this.toeWidthAtZ(z), -0.4, 1.35);
    const H = this.waveHeightAtZ(z);
    const section = this.sectionAtZ(z);
    const sOffshore = this.spot.shoreX - x;
    const depth = Math.max(0.6, depthAtOffshore(this.spot, sOffshore));

    const shallowC = Math.sqrt(9.81 * depth);
    const faceFactor = clamp((height + 0.4) / Math.max(H, 0.5), 0, 1.2);
    const flowX = this.hydro.breakSpeed * (0.16 + 0.31 * faceFactor) + 0.35;
    const flowZ = this.peelDirection * this.spot.peelSpeed * 0.1 * section.curl;
    const flowY = -slopeX * flowX * 0.22 + 0.08 * Math.sin(this.time * 2 + z);
    const flow = v3(flowX, flowY, flowZ);

    const points = this.lipPoints(z);
    let clearance = Infinity;
    let nearestX = x;
    let nearestY = height + 1;
    if (section.curl > 0.28) {
      for (const p of points) {
        const d = Math.hypot(p.x - x, p.y - (height + 0.35));
        if (d < clearance) {
          clearance = d;
          nearestX = p.x;
          nearestY = p.y;
        }
      }
    } else {
      clearance = 99;
    }

    const inPocket = u >= 0.04 && u <= 0.58 && section.behindFront > -7 && section.behindFront < 15;
    const underLip =
      section.curl > 0.42 &&
      u >= 0.05 &&
      u <= 0.58 &&
      x > crestX + H * 0.08 &&
      x < crestX + H * 1.58 &&
      height < H * 1.02 &&
      clearance < 3.6;
    const inTube = underLip && section.age > -0.2 && section.age < 6.5;

    let zone: SurfaceSample['zone'] = 'face';
    if (u < -0.08) zone = 'back';
    else if (u < 0.08) zone = 'crest';
    else if (u <= 0.6) zone = 'pocket';
    else if (u <= 0.92) zone = 'face';
    else zone = u > 1.08 ? 'flat' : 'front';

    return {
      height,
      normal,
      slopeX,
      slopeZ,
      flow,
      depth,
      crestX,
      toeX,
      u,
      faceHeight: height,
      waveHeight: H,
      along: this.alongFromZ(z),
      peelZ: this.peelZ,
      section,
      lip: { points, clearance, nearestX, nearestY, active: section.curl > 0.28 },
      inPocket,
      inTube,
      zone,
    };
  }

  isPastEnd(z: number): boolean {
    return this.alongFromZ(z) > END_ALONG + 10;
  }

  get progress(): number {
    return clamp((this.peelAlong - START_ALONG) / (END_ALONG - START_ALONG), 0, 1);
  }
}
