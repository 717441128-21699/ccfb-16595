import { InputManager } from './InputManager';
import {
  angleDelta,
  clamp,
  cross,
  damp,
  dot,
  length,
  normalize,
  v3,
  wrapAngle,
  type Vec3,
} from './math';
import { G, RHO_AIR, RHO_WATER } from './hydrodynamics';
import { WaveModel } from './WaveModel';

export type CrashReason =
  | 'lip'
  | 'back'
  | 'front'
  | 'stall'
  | 'landing'
  | 'out-of-bounds'
  | null;

export interface ForceReadout {
  gravity: Vec3;
  flow: Vec3;
  lift: Vec3;
  fin: Vec3;
  trim: Vec3;
  airDrag: Vec3;
  total: Vec3;
  liftMagnitude: number;
  finMagnitude: number;
  flowMagnitude: number;
  normalLoad: number;
  lateralG: number;
}

export interface BoardState {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  yawRate: number;
  rail: number;
  railTarget: number;
  trim: number;
  airborne: boolean;
  airTime: number;
  airSpin: number;
  launchSpeed: number;
  launchLipDistance: number;
  groundedTime: number;
  speed: number;
  horizontalSpeed: number;
  maxSpeed: number;
  maxLateralG: number;
  distance: number;
  elapsed: number;
  backTimer: number;
  frontTimer: number;
  lowSpeedTimer: number;
  lipDangerTimer: number;
  crashTimer: number;
  crashReason: CrashReason;
  finished: boolean;
  finishTimer: number;
  forces: ForceReadout;
}

export interface LandingEvent {
  airTime: number;
  spinRadians: number;
  spinDegrees: number;
  alignmentError: number;
  impact: number;
  quality: number;
  speed: number;
  grab: boolean;
  lipDistance: number;
}

export interface PhysicsEvents {
  onJump?: (state: BoardState) => void;
  onLand?: (event: LandingEvent, state: BoardState) => void;
  onCrash?: (reason: Exclude<CrashReason, null>, state: BoardState) => void;
  onFinish?: (state: BoardState) => void;
}

const MASS = 76;
const MAX_RAIL = 0.48;

function zeroForces(): ForceReadout {
  const z = v3();
  return {
    gravity: v3(0, -MASS * G, 0),
    flow: z,
    lift: z,
    fin: z,
    trim: z,
    airDrag: z,
    total: z,
    liftMagnitude: 0,
    finMagnitude: 0,
    flowMagnitude: 0,
    normalLoad: 1,
    lateralG: 0,
  };
}

export class SurfPhysics {
  state: BoardState;
  private jumpRequest = false;
  private crashFired = false;
  private finishFired = false;

  constructor(
    private wave: WaveModel,
    private input: InputManager,
    private events: PhysicsEvents = {},
  ) {
    const p = wave.playerStart();
    this.state = {
      position: { ...p },
      velocity: v3(1.4, 0, wave.peelDirection * 4.4),
      yaw: wave.initialYaw(),
      yawRate: 0,
      rail: 0,
      railTarget: 0,
      trim: 0,
      airborne: false,
      airTime: 0,
      airSpin: 0,
      launchSpeed: 0,
      launchLipDistance: 99,
      groundedTime: 0,
      speed: 4.6,
      horizontalSpeed: 4.6,
      maxSpeed: 4.6,
      maxLateralG: 0,
      distance: 0,
      elapsed: 0,
      backTimer: 0,
      frontTimer: 0,
      lowSpeedTimer: 0,
      lipDangerTimer: 0,
      crashTimer: 0,
      crashReason: null,
      finished: false,
      finishTimer: 0,
      forces: zeroForces(),
    };
  }

  queueJump() {
    if (!this.state.airborne && !this.state.crashReason) this.jumpRequest = true;
  }

  crash(reason: Exclude<CrashReason, null>) {
    if (this.state.crashReason) return;
    this.state.crashReason = reason;
    this.state.crashTimer = 0;
    if (!this.crashFired) {
      this.crashFired = true;
      this.events.onCrash?.(reason, this.state);
    }
  }

  finish() {
    if (this.state.finished) return;
    this.state.finished = true;
    if (!this.finishFired) {
      this.finishFired = true;
      this.events.onFinish?.(this.state);
    }
  }

  step(dt: number) {
    const s = this.state;
    if (s.crashReason) {
      s.crashTimer += dt;
      // Tumble velocity after a wipeout.
      s.velocity.y -= G * dt;
      s.position.x += s.velocity.x * dt;
      s.position.y += s.velocity.y * dt;
      s.position.z += s.velocity.z * dt;
      const surf = this.wave.sample(s.position.x, s.position.z);
      if (s.position.y < surf.height + 0.12) {
        s.position.y = surf.height + 0.12;
        s.velocity.y *= -0.12;
        s.velocity.x *= 0.9;
        s.velocity.z *= 0.9;
      }
      return;
    }

    s.elapsed += dt;
    const steer = clamp(this.input.steerAxis(), -1, 1);
    const trimInput = clamp(this.input.trimAxis(), -1, 1);
    s.railTarget = steer * MAX_RAIL;
    s.rail = damp(s.rail, s.railTarget, 12, dt);
    s.trim = damp(s.trim, trimInput, 7, dt);

    const sample = this.wave.sample(s.position.x, s.position.z);

    if (this.jumpRequest && !s.airborne && s.horizontalSpeed > 2.8) {
      this.launch(sample.normal.y, sample.lip.clearance);
    }
    this.jumpRequest = false;

    if (s.airborne) this.stepAir(dt, steer);
    else this.stepWater(dt, steer, trimInput);

    const horizontalSpeed = Math.hypot(s.velocity.x, s.velocity.z);
    s.horizontalSpeed = horizontalSpeed;
    s.speed = length(s.velocity);
    s.maxSpeed = Math.max(s.maxSpeed, s.speed);
    s.distance += horizontalSpeed * dt;

    this.updateSurvival(dt, sample);

    if (this.wave.isPastEnd(s.position.z)) this.finish();
    if (Math.abs(s.position.z) > 132) this.crash('out-of-bounds');
  }

  private launch(normalY: number, lipDistance: number) {
    const s = this.state;
    s.airborne = true;
    s.airTime = 0;
    s.airSpin = 0;
    s.launchSpeed = s.speed;
    s.launchLipDistance = lipDistance;
    const jumpPower = 4.9 + clamp(s.speed, 0, 12) * 0.1 + (lipDistance < 2.2 ? 0.9 : 0);
    s.velocity.y = Math.max(s.velocity.y, 0) + jumpPower * clamp(normalY + 0.18, 0.72, 1.15);
    this.events.onJump?.(s);
  }

  private stepAir(dt: number, steer: number) {
    const s = this.state;
    s.airTime += dt;
    const oldYaw = s.yaw;
    const spinAuthority = clamp(s.airTime * 1.8, 0, 1);
    const targetYawRate = steer * (3.1 + 1.1 * spinAuthority);
    s.yawRate = damp(s.yawRate, targetYawRate, 7.5, dt);
    s.yaw += s.yawRate * dt;
    s.airSpin += angleDelta(s.yaw, oldYaw);

    const gravity = v3(0, -MASS * G, 0);
    const airDrag = v3(
      -0.5 * RHO_AIR * 0.42 * s.speed * s.velocity.x,
      0,
      -0.5 * RHO_AIR * 0.42 * s.speed * s.velocity.z,
    );
    const acc = {
      x: (gravity.x + airDrag.x) / MASS,
      y: (gravity.y + airDrag.y) / MASS,
      z: (gravity.z + airDrag.z) / MASS,
    };
    s.velocity.x += acc.x * dt;
    s.velocity.y += acc.y * dt;
    s.velocity.z += acc.z * dt;
    s.position.x += s.velocity.x * dt;
    s.position.y += s.velocity.y * dt;
    s.position.z += s.velocity.z * dt;

    const surf = this.wave.sample(s.position.x, s.position.z);
    if (s.velocity.y <= 0 && s.position.y <= surf.height + 0.16) {
      this.land(surf.height, surf.normal, surf.lip.clearance);
    }
    if (s.airTime > 2.4) {
      // Failsafe: should normally have landed.
      s.position.y = Math.max(s.position.y, surf.height + 0.2);
      this.land(surf.height, surf.normal, surf.lip.clearance);
    }
  }

  private land(surfaceHeight: number, normal: Vec3, lipDistance: number) {
    const s = this.state;
    const moveYaw = Math.atan2(s.velocity.z, s.velocity.x);
    const alignmentError = Math.abs(wrapAngle(s.yaw - moveYaw));
    const impact = Math.max(0, -s.velocity.y);
    const quality = clamp(1 - alignmentError / 1.15 - Math.max(0, impact - 5.2) * 0.07, 0, 1);

    if (quality < 0.34) {
      s.position.y = surfaceHeight + 0.2;
      this.crash('landing');
      return;
    }

    const event: LandingEvent = {
      airTime: s.airTime,
      spinRadians: s.airSpin,
      spinDegrees: Math.abs((s.airSpin * 180) / Math.PI),
      alignmentError,
      impact,
      quality,
      speed: s.speed,
      grab: this.input.grab,
      lipDistance,
    };
    s.airborne = false;
    s.airTime = 0;
    s.airSpin = 0;
    s.groundedTime = 0;
    s.position.y = surfaceHeight + 0.07;
    const vn = dot(s.velocity, normal);
    s.velocity.x -= normal.x * vn;
    s.velocity.y -= normal.y * vn;
    s.velocity.z -= normal.z * vn;
    s.velocity.x *= 0.9 + 0.08 * quality;
    s.velocity.z *= 0.9 + 0.08 * quality;
    this.events.onLand?.(event, s);
  }

  private stepWater(dt: number, steer: number, trimInput: number) {
    const s = this.state;
    s.groundedTime += dt;

    // Yaw is rider-controlled; fin force below pulls the velocity vector after it.
    const speedForRudder = clamp(s.horizontalSpeed / 5.5, 0.25, 1.35);
    const trimTurn = 1 + Math.max(0, -s.trim) * 0.42 - Math.max(0, s.trim) * 0.12;
    const targetYawRate = steer * 1.55 * speedForRudder * trimTurn;
    s.yawRate = damp(s.yawRate, targetYawRate, 9.5, dt);
    s.yaw = wrapAngle(s.yaw + s.yawRate * dt);

    const sample = this.wave.sample(s.position.x, s.position.z);
    const n = sample.normal;
    const forwardH = v3(Math.cos(s.yaw), 0, Math.sin(s.yaw));
    let forward = normalize({
      x: forwardH.x - n.x * dot(forwardH, n),
      y: forwardH.y - n.y * dot(forwardH, n),
      z: forwardH.z - n.z * dot(forwardH, n),
    });
    if (length(forward) < 0.1) forward = forwardH;
    const right = normalize(cross(forward, n));

    const rel = {
      x: s.velocity.x - sample.flow.x,
      y: s.velocity.y - sample.flow.y,
      z: s.velocity.z - sample.flow.z,
    };
    const relSpeed = Math.max(0.1, length(rel));

    // Gravity.
    const gravity = v3(0, -MASS * G, 0);

    // Quadratic water drag against the moving wave-flow vector. The large
    // lateral resistance is supplied separately by the fin/rail model.
    const waterCdA = 0.021;
    const kWater = 0.5 * RHO_WATER * waterCdA;
    const flow = {
      x: -kWater * relSpeed * rel.x,
      y: -kWater * relSpeed * rel.y * 0.25,
      z: -kWater * relSpeed * rel.z,
    };

    // Aerodynamic drag.
    const airDrag = {
      x: -0.5 * RHO_AIR * 0.52 * s.speed * s.velocity.x,
      y: 0,
      z: -0.5 * RHO_AIR * 0.52 * s.speed * s.velocity.z,
    };

    // Rider weight shift: front foot drives, back foot brakes and pivots.
    const trimMagnitude = trimInput > 0 ? 520 * trimInput : 610 * trimInput;
    const trim = {
      x: forward.x * trimMagnitude,
      y: forward.y * trimMagnitude,
      z: forward.z * trimMagnitude,
    };
    if (trimInput < -0.05) {
      const brake = 90 * s.horizontalSpeed * clamp(-trimInput, 0, 1);
      trim.x -= forward.x * brake;
      trim.y -= forward.y * brake;
      trim.z -= forward.z * brake;
    }

    // Planing lift acts through the edged board bottom.
    const dynamicPressure = 0.5 * RHO_WATER * relSpeed * relSpeed;
    const liftArea = 0.36;
    const liftCoefficient = 0.078 + 0.018 * clamp(s.horizontalSpeed / 10, 0, 1) + Math.max(0, s.trim) * 0.012;
    const liftMagnitude = dynamicPressure * liftArea * liftCoefficient;
    const boardNormal = normalize({
      x: n.x * Math.cos(s.rail) + right.x * Math.sin(s.rail),
      y: n.y * Math.cos(s.rail) + right.y * Math.sin(s.rail),
      z: n.z * Math.cos(s.rail) + right.z * Math.sin(s.rail),
    });
    const lift = {
      x: boardNormal.x * liftMagnitude,
      y: boardNormal.y * liftMagnitude,
      z: boardNormal.z * liftMagnitude,
    };

    // Fin/rudder lateral force, using sideslip plus rider rudder angle.
    const vForward = dot(s.velocity, forward);
    const vRight = dot(s.velocity, right);
    const sideslip = Math.atan2(vRight, Math.max(1.5, Math.abs(vForward)));
    const rudderAngle = steer * 0.31 * clamp(s.horizontalSpeed / 3.2, 0, 1.15);
    const finAttack = clamp(rudderAngle - sideslip * 0.82, -0.62, 0.62);
    const finArea = 0.06;
    const finMagnitude = dynamicPressure * finArea * 2.35 * finAttack;
    const fin = {
      x: right.x * finMagnitude,
      y: right.y * finMagnitude,
      z: right.z * finMagnitude,
    };

    const total = {
      x: gravity.x + flow.x + airDrag.x + trim.x + lift.x + fin.x,
      y: gravity.y + flow.y + airDrag.y + trim.y + lift.y + fin.y,
      z: gravity.z + flow.z + airDrag.z + trim.z + lift.z + fin.z,
    };

    s.forces.gravity = gravity;
    s.forces.flow = flow;
    s.forces.lift = lift;
    s.forces.fin = fin;
    s.forces.trim = trim;
    s.forces.airDrag = airDrag;
    s.forces.total = total;
    s.forces.liftMagnitude = liftMagnitude;
    s.forces.finMagnitude = Math.abs(finMagnitude);
    s.forces.flowMagnitude = length(flow);
    s.forces.normalLoad = clamp(liftMagnitude / (MASS * G), 0.4, 4);
    const lateralAccel = Math.abs(dot({ x: total.x / MASS, y: total.y / MASS, z: total.z / MASS }, right));
    s.forces.lateralG = lateralAccel / G;
    s.maxLateralG = Math.max(s.maxLateralG, s.forces.lateralG);

    // Integrate, then enforce the wave-surface contact constraint.
    s.velocity.x += (total.x / MASS) * dt;
    s.velocity.y += (total.y / MASS) * dt;
    s.velocity.z += (total.z / MASS) * dt;

    // Soft speed envelope keeps the arcade model stable while staying near wave c.
    const hs = Math.hypot(s.velocity.x, s.velocity.z);
    const maxSpeed = 11.4;
    if (hs > maxSpeed) {
      const k = clamp(1 - (hs - maxSpeed) * 0.055, 0.82, 1);
      s.velocity.x *= k;
      s.velocity.z *= k;
    }

    s.position.x += s.velocity.x * dt;
    s.position.y += s.velocity.y * dt;
    s.position.z += s.velocity.z * dt;

    const next = this.wave.sample(s.position.x, s.position.z);
    s.position.y = next.height + 0.075;
    const normalVelocity = dot(s.velocity, next.normal);
    if (normalVelocity > -0.2) {
      // Remove outward/normal component so the board tracks the face.
      s.velocity.x -= next.normal.x * normalVelocity;
      s.velocity.y -= next.normal.y * normalVelocity;
      s.velocity.z -= next.normal.z * normalVelocity;
    } else {
      s.velocity.x -= next.normal.x * normalVelocity;
      s.velocity.y -= next.normal.y * normalVelocity;
      s.velocity.z -= next.normal.z * normalVelocity;
    }

    // Mild stance stability: prevent pure numerical reverse degeneracy.
    if (![s.position.x, s.position.y, s.position.z].every(Number.isFinite)) {
      this.crash('out-of-bounds');
    }
  }

  private updateSurvival(dt: number, sample: ReturnType<WaveModel['sample']>) {
    const s = this.state;
    if (s.airborne) return;

    if (sample.zone === 'back' || sample.u < -0.16) s.backTimer += dt;
    else s.backTimer = Math.max(0, s.backTimer - dt * 1.7);

    if (sample.u > 1.1 || sample.zone === 'flat') s.frontTimer += dt;
    else s.frontTimer = Math.max(0, s.frontTimer - dt * 1.4);

    if (s.horizontalSpeed < 2.7) s.lowSpeedTimer += dt;
    else s.lowSpeedTimer = Math.max(0, s.lowSpeedTimer - dt * 1.5);

    if (sample.lip.active && sample.lip.clearance < 1.05 && s.elapsed > 1.4) s.lipDangerTimer += dt;
    else s.lipDangerTimer = Math.max(0, s.lipDangerTimer - dt * 2);

    if (s.elapsed > 1.4 && sample.lip.active && sample.lip.clearance < 0.5) this.crash('lip');
    else if (s.lipDangerTimer > 0.72) this.crash('lip');
    else if (s.backTimer > 1.45) this.crash('back');
    else if (s.frontTimer > 1.9) this.crash('front');
    else if (s.lowSpeedTimer > 3.2) this.crash('stall');
  }
}
