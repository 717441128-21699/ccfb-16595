import type { LandingEvent, BoardState, CrashReason } from './SurfPhysics';
import type { SurfaceSample } from './WaveModel';
import { angleDelta, clamp, radToDeg } from './math';

export interface ScorePopup {
  id: number;
  title: string;
  detail: string;
  points: number;
  kind: 'turn' | 'air' | 'tube' | 'zone' | 'warn' | 'finish';
  ttl: number;
}

export interface TrickScore {
  id: number;
  kind: 'turn' | 'air';
  name: string;
  points: number;
  completion: number;
  time: number;
  detail: string;
}

export interface JudgeScore {
  judge: string;
  country: string;
  score: number;
  comment: string;
}

export interface CriterionScore {
  key: string;
  label: string;
  score: number;
  note: string;
}

export interface RunReport {
  id: string;
  createdAt: number;
  spotId: string;
  spotName: string;
  breakerLabel: string;
  iribarren: number;
  duration: number;
  totalScore: number;
  completed: boolean;
  finishReason: string;
  crashReason: CrashReason;
  distance: number;
  maxSpeed: number;
  maxSpeedKmh: number;
  waveSpeed: number;
  speedOrderRatio: number;
  speedOrderOk: boolean;
  tubeTime: number;
  pocketTime: number;
  powerZoneTime: number;
  maxLateralG: number;
  turnCount: number;
  aerialCount: number;
  bestTrick: TrickScore | null;
  tricks: TrickScore[];
  judges: JudgeScore[];
  criteria: CriterionScore[];
  heatScore: number;
}

const CRASH_TEXT: Record<Exclude<CrashReason, null>, string> = {
  lip: '距离卷唇太近，被浪唇扣落',
  back: '太靠后，滑出浪背失去推力',
  front: '太靠前，冲到浪脚平水区被甩下',
  stall: '速度过低，失去板底升力',
  landing: '腾空落地角度未完成，板缘失速',
  'out-of-bounds': '离开可冲浪段',
};

export function crashReasonText(reason: CrashReason): string {
  return reason ? CRASH_TEXT[reason] : '完成浪段';
}

export class ScoringEngine {
  totalScore = 0;
  tubeTime = 0;
  pocketTime = 0;
  powerZoneTime = 0;
  turnCount = 0;
  aerialCount = 0;
  tricks: TrickScore[] = [];
  popups: ScorePopup[] = [];

  private popupId = 1;
  private trickId = 1;
  private lastYaw = 0;
  private carveDirection = 0;
  private carveAccum = 0;
  private carveTime = 0;
  private carveMaxRail = 0;
  private carveMaxG = 0;
  private carveMaxSpeed = 0;
  private carveMaxU = 1;
  private carveMinU = 1;
  private idleCarveTime = 0;
  private tubeTickAccum = 0;
  private bestTubeClearance = 99;
  private spotDifficulty = 1;
  private spotId = '';
  private spotName = '';
  private breakerLabel = '';
  private iribarren = 0;
  private waveSpeed = 1;
  private startTime = 0;

  configure(args: {
    spotId: string;
    spotName: string;
    breakerLabel: string;
    iribarren: number;
    waveSpeed: number;
    difficulty: number;
  }) {
    this.spotId = args.spotId;
    this.spotName = args.spotName;
    this.breakerLabel = args.breakerLabel;
    this.iribarren = args.iribarren;
    this.waveSpeed = args.waveSpeed;
    this.spotDifficulty = args.difficulty;
    this.lastYaw = 0;
  }

  reset(startYaw: number) {
    this.totalScore = 0;
    this.tubeTime = 0;
    this.pocketTime = 0;
    this.powerZoneTime = 0;
    this.turnCount = 0;
    this.aerialCount = 0;
    this.tricks = [];
    this.popups = [];
    this.lastYaw = startYaw;
    this.carveDirection = 0;
    this.carveAccum = 0;
  }

  popup(title: string, detail: string, points: number, kind: ScorePopup['kind']) {
    this.popups.push({ id: this.popupId++, title, detail, points, kind, ttl: 2.8 });
    if (this.popups.length > 8) this.popups.shift();
  }

  updatePopups(dt: number) {
    for (const p of this.popups) p.ttl -= dt;
    this.popups = this.popups.filter((p) => p.ttl > 0);
  }

  update(dt: number, board: BoardState, surf: SurfaceSample) {
    this.updatePopups(dt);
    if (board.crashReason) return;

    if (surf.inTube && !board.airborne) {
      this.tubeTime += dt;
      this.tubeTickAccum += dt;
      this.bestTubeClearance = Math.min(this.bestTubeClearance, surf.lip.clearance);
      const proximity = clamp(1.55 - Math.abs(surf.lip.clearance - 1.65) * 0.22, 0.85, 1.55);
      this.totalScore += dt * 24 * proximity * (0.85 + this.spotDifficulty * 0.08);
      if (this.tubeTickAccum > 0.85) {
        const pts = Math.round(22 * this.tubeTickAccum * proximity * 10) / 10;
        this.popup('管浪穿行', `与卷唇距离 ${surf.lip.clearance.toFixed(1)} m`, Math.round(pts), 'tube');
        this.tubeTickAccum = 0;
      }
    } else {
      this.tubeTickAccum = Math.min(this.tubeTickAccum, 0.4);
    }

    if (surf.inPocket) {
      this.pocketTime += dt;
      this.totalScore += dt * 7.5;
    }
    if (surf.zone === 'pocket' || surf.zone === 'crest') {
      this.powerZoneTime += dt;
      this.totalScore += dt * 3.5;
    }

    this.scoreCarving(dt, board, surf);
  }

  private scoreCarving(dt: number, board: BoardState, surf: SurfaceSample) {
    if (board.airborne) {
      this.flushCarve(board, true);
      this.lastYaw = board.yaw;
      return;
    }

    const delta = angleDelta(board.yaw, this.lastYaw);
    this.lastYaw = board.yaw;
    const rate = board.yawRate;

    if (Math.abs(rate) > 0.32 && Math.abs(delta) > 0.0005) {
      const dir = Math.sign(delta);
      if (this.carveDirection === 0) {
        this.carveDirection = dir;
        this.carveAccum = 0;
        this.carveTime = 0;
        this.carveMaxRail = 0;
        this.carveMaxG = 0;
        this.carveMaxSpeed = 0;
        this.carveMaxU = 0;
        this.carveMinU = 2;
      }
      if (dir === this.carveDirection) {
        this.carveAccum += delta;
        this.carveTime += dt;
        this.carveMaxRail = Math.max(this.carveMaxRail, Math.abs(board.rail));
        this.carveMaxG = Math.max(this.carveMaxG, board.forces.lateralG);
        this.carveMaxSpeed = Math.max(this.carveMaxSpeed, board.horizontalSpeed);
        this.carveMaxU = Math.max(this.carveMaxU, surf.u);
        this.carveMinU = Math.min(this.carveMinU, surf.u);
        this.idleCarveTime = 0;
      } else {
        this.flushCarve(board);
      }
    } else if (this.carveDirection !== 0) {
      this.idleCarveTime += dt;
      this.carveTime += dt;
      if (this.idleCarveTime > 0.28) this.flushCarve(board);
    }
  }

  private flushCarve(board: BoardState, silent = false) {
    if (this.carveDirection === 0) return;
    const absDeg = Math.abs(radToDeg(this.carveAccum));
    const avgSpeed = this.carveMaxSpeed;
    const enough = absDeg >= 62 && this.carveTime > 0.35 && avgSpeed > 3.4;

    if (enough && !silent) {
      const targetDeg = absDeg >= 285 ? 360 : absDeg >= 135 ? 180 : 90;
      const completion = clamp(absDeg / targetDeg, 0.35, 1);
      const railQuality = clamp(this.carveMaxRail / 0.42, 0, 1);
      const powerQuality = clamp((this.carveMaxG * 0.55 + avgSpeed / 11) / 1.25, 0.35, 1.35);
      const zoneQuality = this.carveMinU < 0.28 ? 1.12 : this.carveMaxU > 0.72 ? 1.05 : 0.92;
      const points = Math.round(
        targetDeg * 1.15 * completion * (0.55 + 0.45 * railQuality) * powerQuality * zoneQuality,
      );

      let name = '浪壁切转';
      if (targetDeg === 360) name = '360 完整回转';
      else if (this.carveMinU < 0.24 && absDeg > 110) name = '浪峰回切 Re-entry';
      else if (this.carveMaxU > 0.68 && absDeg > 80) name = '底转加速 Bottom Turn';
      else if (targetDeg === 180) name = '180 大幅 Carve';

      const trick: TrickScore = {
        id: this.trickId++,
        kind: 'turn',
        name,
        points,
        completion: Math.round(completion * 100) / 100,
        time: board.elapsed,
        detail: `${Math.round(absDeg)}° · 板缘 ${Math.round(radToDeg(this.carveMaxRail))}° · ${avgSpeed.toFixed(1)} m/s`,
      };
      this.tricks.push(trick);
      this.turnCount++;
      this.totalScore += points;
      this.popup(name, `完成度 ${Math.round(completion * 100)}% · ${trick.detail}`, points, 'turn');
    }

    this.carveDirection = 0;
    this.carveAccum = 0;
    this.carveTime = 0;
    this.idleCarveTime = 0;
  }

  scoreLanding(event: LandingEvent, board: BoardState) {
    this.aerialCount++;
    const spinDeg = Math.abs(event.spinDegrees);
    const targetDeg = spinDeg < 48 ? 0 : Math.max(180, Math.round(spinDeg / 180) * 180);
    let rotationCompletion: number;
    if (targetDeg === 0) rotationCompletion = clamp(1 - spinDeg / 70, 0.55, 1);
    else rotationCompletion = clamp(1 - Math.abs(spinDeg - targetDeg) / (targetDeg === 180 ? 135 : 210), 0.25, 1);
    const completion = clamp(rotationCompletion * 0.48 + event.quality * 0.52, 0, 1);
    const grabBonus = event.grab ? 1.18 : 1;
    const tubeLaunchBonus = event.lipDistance < 2.4 ? 1.28 : 1;
    const points = Math.round(
      (65 + event.airTime * 145 + spinDeg * 0.82) *
        completion *
        (0.72 + event.speed / 13) *
        (0.9 + this.spotDifficulty * 0.08) *
        grabBonus *
        tubeLaunchBonus,
    );

    const name =
      targetDeg === 0
        ? event.grab
          ? '抓板直飞'
          : '腾空 Ollie'
        : `${targetDeg}° ${event.grab ? '抓板转体' : '转体'}`;
    const trick: TrickScore = {
      id: this.trickId++,
      kind: 'air',
      name,
      points,
      completion: Math.round(completion * 100) / 100,
      time: board.elapsed,
      detail: `${event.airTime.toFixed(2)}s · 落地质量 ${Math.round(event.quality * 100)}%${event.grab ? ' · Grab' : ''}`,
    };
    this.tricks.push(trick);
    this.totalScore += points;
    this.popup(name, `完成度 ${Math.round(completion * 100)}% · +${points}`, points, 'air');
  }

  buildReport(board: BoardState, completed: boolean): RunReport {
    this.flushCarve(board, true);
    const duration = board.elapsed;
    const maxSpeedKmh = board.maxSpeed * 3.6;
    const speedOrderRatio = board.maxSpeed / Math.max(0.1, this.waveSpeed);
    const bestTrick = [...this.tricks].sort((a, b) => b.points - a.points)[0] ?? null;

    const criteria = this.buildCriteria(board, completed);
    const judges = this.buildJudges(criteria);
    const criterionAverage = criteria.reduce((sum, c) => sum + c.score, 0) / criteria.length;
    const heatScore = clamp(Math.round(criterionAverage * 10) / 10, 0, 10);

    return {
      id: `run-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      createdAt: Date.now(),
      spotId: this.spotId,
      spotName: this.spotName,
      breakerLabel: this.breakerLabel,
      iribarren: this.iribarren,
      duration,
      totalScore: Math.round(this.totalScore),
      completed,
      finishReason: crashReasonText(board.crashReason),
      crashReason: board.crashReason,
      distance: board.distance,
      maxSpeed: board.maxSpeed,
      maxSpeedKmh,
      waveSpeed: this.waveSpeed,
      speedOrderRatio,
      speedOrderOk: speedOrderRatio >= 0.65 && speedOrderRatio <= 2.2,
      tubeTime: this.tubeTime,
      pocketTime: this.pocketTime,
      powerZoneTime: this.powerZoneTime,
      maxLateralG: board.maxLateralG,
      turnCount: this.turnCount,
      aerialCount: this.aerialCount,
      bestTrick,
      tricks: [...this.tricks].sort((a, b) => b.time - a.time),
      judges,
      criteria,
      heatScore,
    };
  }

  private buildCriteria(board: BoardState, completed: boolean): CriterionScore[] {
    const tube = clamp(this.tubeTime / 7, 0, 1);
    const difficulty = clamp((this.spotDifficulty - 1) / 4, 0, 1);
    const air = clamp(this.aerialCount / 3, 0, 1);
    const turnVariety = clamp(this.turnCount / 6, 0, 1);
    const speed = clamp(board.maxSpeed / 11.5, 0, 1);
    const flow = clamp((this.pocketTime + this.powerZoneTime * 0.4) / Math.max(8, board.elapsed), 0, 1);
    const completion = completed ? 1 : board.crashReason === 'stall' ? 0.35 : 0.58;

    const score = (v: number, base = 4.2) => Math.round(clamp(base + v * 5.6, 2.5, 9.9) * 10) / 10;
    return [
      { key: 'commitment', label: '投入 / 管浪', score: score(tube * 0.75 + difficulty * 0.25), note: `管浪 ${this.tubeTime.toFixed(1)} 秒` },
      { key: 'difficulty', label: '难度', score: score(difficulty * 0.75 + air * 0.25), note: `浪点难度 ${this.spotDifficulty}/5` },
      { key: 'innovation', label: '创新 / 腾空', score: score(air * 0.8 + (this.bestAirCompletion() ?? 0) * 0.2), note: `${this.aerialCount} 次腾空` },
      { key: 'variety', label: '变化 / 动作组合', score: score(turnVariety * 0.7 + air * 0.3), note: `${this.turnCount} 个有效切转` },
      { key: 'speed', label: '速度 / 力量', score: score(speed * 0.75 + clamp(board.maxLateralG / 2.4, 0, 1) * 0.25), note: `${board.maxSpeed.toFixed(1)} m/s` },
      { key: 'flow', label: '流畅 / 完浪', score: score(flow * 0.65 + completion * 0.35), note: completed ? '完成浪段' : '中途落水' },
    ];
  }

  private bestAirCompletion(): number | null {
    const airs = this.tricks.filter((t) => t.kind === 'air');
    if (!airs.length) return null;
    return Math.max(...airs.map((a) => a.completion));
  }

  private buildJudges(criteria: CriterionScore[]): JudgeScore[] {
    const base = criteria.reduce((sum, c) => sum + c.score, 0) / criteria.length;
    const judges = [
      { judge: '林 澈', country: 'CHN', bias: 0.25, comment: '管腔路线清晰，关键段没有多余减速。' },
      { judge: 'Kai M.', country: 'HAW', bias: 0.05, comment: 'Speed and rail engagement are real; finish stronger.' },
      { judge: '丸山 渚', country: 'JPN', bias: -0.15, comment: '落地控制不错，但动作组合还可以更密。' },
      { judge: 'Sofia R.', country: 'PRT', bias: 0.12, comment: '浪壁上下切走有节奏，腾空完成度稳定。' },
      { judge: 'Ari T.', country: 'AUS', bias: -0.05, comment: 'Power pocket selection good; commit deeper next heat.' },
    ];
    return judges.map((j) => ({
      judge: j.judge,
      country: j.country,
      score: Math.round(clamp(base + j.bias, 0.5, 10) * 10) / 10,
      comment: j.comment,
    }));
  }
}
