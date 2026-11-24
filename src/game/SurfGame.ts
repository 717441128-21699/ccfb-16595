import { InputManager } from './InputManager';
import { WaveModel } from './WaveModel';
import { SurfPhysics, type BoardState } from './SurfPhysics';
import { ScoringEngine, type RunReport, type ScorePopup } from './Scoring';
import { SurfRenderer } from '../render/SurfRenderer';
import type { SpotConfig } from './hydrodynamics';
import { saveReport } from './storage';
import { clamp } from './math';

export type GameStatus = 'countdown' | 'running' | 'paused' | 'over';

export interface HudSnapshot {
  status: GameStatus;
  countdown: number;
  speedKmh: number;
  maxSpeedKmh: number;
  waveSpeed: number;
  speedRatio: number;
  score: number;
  elapsed: number;
  progress: number;
  zone: string;
  zoneTone: 'good' | 'warn' | 'bad' | 'neutral';
  warning: string;
  inTube: boolean;
  tubeTime: number;
  lipClearance: number;
  trim: number;
  rail: number;
  yawDeg: number;
  forces: BoardState['forces'];
  popups: ScorePopup[];
  report: RunReport | null;
  crashReason: string | null;
}

export interface GameCallbacks {
  onHud?: (hud: HudSnapshot) => void;
  onReport?: (report: RunReport) => void;
}

const FIXED_STEP = 1 / 120;

export class SurfGame {
  readonly wave: WaveModel;
  readonly input = new InputManager();
  readonly scoring = new ScoringEngine();
  readonly physics: SurfPhysics;
  private renderer: SurfRenderer;
  private raf = 0;
  private lastTime = 0;
  private accumulator = 0;
  private status: GameStatus = 'countdown';
  private countdown = 2.8;
  private overTimer = 0;
  private report: RunReport | null = null;
  private completed = false;
  private destroyed = false;
  private hudTimer = 0;

  constructor(
    canvas: HTMLCanvasElement,
    readonly spot: SpotConfig,
    readonly callbacks: GameCallbacks = {},
  ) {
    this.wave = new WaveModel(spot);
    this.wave.reset();
    this.scoring.configure({
      spotId: spot.id,
      spotName: spot.name,
      breakerLabel: this.wave.hydro.breakerLabel,
      iribarren: this.wave.hydro.iribarren,
      waveSpeed: this.wave.hydro.breakSpeed,
      difficulty: spot.difficulty,
    });
    this.scoring.reset(this.wave.initialYaw());
    this.physics = new SurfPhysics(this.wave, this.input, {
      onLand: (e) => this.scoring.scoreLanding(e, this.physics.state),
      onCrash: (reason) => {
        const text =
          reason === 'lip'
            ? '卷唇碰撞'
            : reason === 'back'
              ? '掉出浪后'
              : reason === 'front'
                ? '被浪甩下'
                : reason === 'landing'
                  ? '落地失败'
                  : reason === 'stall'
                    ? '失速落水'
                    : '冲出浪段';
        this.scoring.popup(text, '评分结束前仍会记录本轮动作', 0, 'warn');
        this.overTimer = 1.9;
      },
      onFinish: () => {
        this.completed = true;
        this.overTimer = 1.7;
        this.scoring.popup('完成浪段', '正在送入比赛评分页…', 0, 'finish');
      },
    });
    this.renderer = new SurfRenderer(canvas, this.wave);
    this.input.attach();
  }

  start() {
    this.lastTime = performance.now();
    const loop = (now: number) => {
      if (this.destroyed) return;
      const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
      this.lastTime = now;
      this.frame(dt);
      if (!this.destroyed) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.renderer.dispose();
  }

  togglePause() {
    if (this.status === 'running') this.status = 'paused';
    else if (this.status === 'paused') {
      this.status = 'running';
      this.lastTime = performance.now();
    }
    this.emitHud(0);
  }

  restart() {
    this.report = null;
    this.completed = false;
    this.overTimer = 0;
    this.countdown = 2.4;
    this.status = 'countdown';
    this.wave.reset();
    this.scoring.reset(this.wave.initialYaw());
    // Recreate physics state by replacement is awkward for renderer references;
    // easiest robust restart is a full page-level remount through location hash event.
    window.dispatchEvent(new CustomEvent('lineup:restart-game'));
  }

  private frame(dt: number) {
    if (this.input.consumeRestart()) {
      this.restart();
      return;
    }
    if (this.input.consumePause()) this.togglePause();
    if (this.status === 'paused') {
      this.renderer.render(this.physics.state, 0);
      this.emitHud(dt);
      return;
    }

    if (this.status === 'countdown') {
      this.countdown -= dt;
      this.wave.update(dt * 0.7);
      if (this.countdown <= 0) this.status = 'running';
    }

    if (this.status === 'running') {
      if (this.input.consumeJump()) this.physics.queueJump();
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= FIXED_STEP && steps < 8) {
        this.physics.step(FIXED_STEP);
        const scoredSample = this.wave.sample(this.physics.state.position.x, this.physics.state.position.z);
        this.scoring.update(FIXED_STEP, this.physics.state, scoredSample);
        this.accumulator -= FIXED_STEP;
        steps++;
      }
      this.wave.update(dt);

      if (this.physics.state.crashReason || this.physics.state.finished) {
        this.overTimer -= dt;
        if (this.overTimer <= 0 && !this.report) this.finalize();
      }
    }

    this.renderer.render(this.physics.state, dt);
    this.hudTimer += dt;
    if (this.hudTimer > 0.08) {
      this.emitHud(dt);
      this.hudTimer = 0;
    }
  }

  private finalize() {
    this.report = this.scoring.buildReport(this.physics.state, this.completed && !this.physics.state.crashReason);
    saveReport(this.report);
    this.status = 'over';
    this.callbacks.onReport?.(this.report);
    this.emitHud(0);
  }

  private zoneInfo(): Pick<HudSnapshot, 'zone' | 'zoneTone' | 'warning'> {
    const s = this.physics.state;
    const surf = this.wave.sample(s.position.x, s.position.z);
    let zone = '浪壁';
    let zoneTone: HudSnapshot['zoneTone'] = 'neutral';
    let warning = '';

    if (surf.inTube) {
      zone = '管浪中';
      zoneTone = 'good';
    } else if (surf.inPocket) {
      zone = '能量口袋';
      zoneTone = 'good';
    } else {
      switch (surf.zone) {
        case 'back':
          zone = '浪后';
          zoneTone = 'bad';
          break;
        case 'crest':
          zone = '浪峰';
          zoneTone = 'warn';
          break;
        case 'pocket':
          zone = '能量口袋';
          zoneTone = 'good';
          break;
        case 'face':
          zone = '浪壁';
          zoneTone = 'neutral';
          break;
        case 'front':
          zone = '浪脚';
          zoneTone = 'warn';
          break;
        case 'flat':
          zone = '前方平水';
          zoneTone = 'bad';
          break;
      }
    }

    if (s.backTimer > 0.45) warning = '重心压前 / 向浪壁下方切，否则会从浪后掉出';
    else if (s.frontTimer > 0.55) warning = '向上回转！太靠前会冲进平水被甩下';
    else if (s.lowSpeedTimer > 0.9) warning = '速度不足：压前脚 W，或向下切一浪获得重力加速';
    else if (s.lipDangerTimer > 0.2) warning = '离卷唇太近，向管腔外侧修正';
    else if (surf.inTube && surf.lip.clearance < 1.25) warning = '保持距离：再向外一点，别顶到浪唇';

    return { zone, zoneTone, warning };
  }

  private emitHud(dt: number) {
    if (!this.callbacks.onHud) return;
    const s = this.physics.state;
    const surf = this.wave.sample(s.position.x, s.position.z);
    const zone = this.zoneInfo();
    const hud: HudSnapshot = {
      status: this.status,
      countdown: Math.max(0, this.countdown),
      speedKmh: s.speed * 3.6,
      maxSpeedKmh: s.maxSpeed * 3.6,
      waveSpeed: this.wave.hydro.breakSpeed,
      speedRatio: s.maxSpeed / Math.max(0.1, this.wave.hydro.breakSpeed),
      score: Math.round(this.scoring.totalScore),
      elapsed: s.elapsed,
      progress: this.wave.progress,
      ...zone,
      inTube: surf.inTube,
      tubeTime: this.scoring.tubeTime,
      lipClearance: Number.isFinite(surf.lip.clearance) ? surf.lip.clearance : 99,
      trim: s.trim,
      rail: s.rail,
      yawDeg: (s.yaw * 180) / Math.PI,
      forces: s.forces,
      popups: [...this.scoring.popups],
      report: this.report,
      crashReason: s.crashReason,
    };
    this.callbacks.onHud(hud);
  }

  /** Touch/UI button hook. Edge actions are queued through InputManager so
   *  keyboard and pointer inputs share exactly one code path. */
  pressVirtual(action: 'left' | 'right' | 'drive' | 'brake' | 'jump' | 'grab' | 'pause', pressed: boolean) {
    this.input.setVirtual(action, pressed);
  }

  requestJump() {
    this.physics.queueJump();
  }
}

export function speedOrderLabel(ratio: number): string {
  const r = clamp(ratio, 0, 3);
  if (r < 0.65) return '板速低于浪速量级';
  if (r <= 2.2) return '与浪传播速度同一量级';
  return '板速异常高于浪速';
}
