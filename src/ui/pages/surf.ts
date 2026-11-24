import { getSpot } from '../../game/spots';
import { SurfGame, type HudSnapshot } from '../../game/SurfGame';
import type { RunReport } from '../../game/Scoring';
import { formatTime, radToDeg } from '../../game/math';
import { h } from '../dom';

export function renderSurf(root: HTMLElement, spotId?: string): () => void {
  const spot = getSpot(spotId);
  root.className = 'surf-route';

  const canvas = h('canvas', { class: 'surf-canvas', 'aria-label': `${spot.name} WebGL2 冲浪画面` }) as HTMLCanvasElement;
  const hud = h('div', { class: 'hud' });
  root.append(canvas, hud);

  let game: SurfGame | null = null;
  let hudRefs: ReturnType<typeof buildHud> | null = null;
  try {
    game = new SurfGame(canvas, spot, {
      onReport: (report) => hudRefs?.showReport(report),
    });
  } catch (error) {
    root.append(
      h('div', { class: 'webgl-error card' },
        h('h2', {}, '无法启动 WebGL2'),
        h('pre', { class: 'error-stack' }, error instanceof Error ? (error.stack ?? error.message) : String(error)),
        h('a', { class: 'btn primary', href: '#/spots' }, '返回浪点选择')),
    );
    return () => undefined;
  }

  hudRefs = buildHud(hud, game, spot);
  const refs = hudRefs;
  game.callbacks.onHud = (snapshot) => refs.update(snapshot);
  (window as unknown as { __lineupGame?: SurfGame }).__lineupGame = game;
  game.start();

  const restartHandler = () => {
    cleanup();
    renderSurf(root, spotId);
  };
  window.addEventListener('lineup:restart-game', restartHandler);

  function cleanup() {
    window.removeEventListener('lineup:restart-game', restartHandler);
    game?.destroy();
    root.className = '';
    root.replaceChildren();
  }

  return cleanup;
}

function buildHud(hud: HTMLElement, game: SurfGame, spot: ReturnType<typeof getSpot>) {
  const scoreValue = h('strong', { class: 'score-value' }, '0');
  const timeValue = h('span', {}, '0:00.0');
  const progressFill = h('i', { class: 'progress-fill' });
  const zonePill = h('div', { class: 'zone-pill neutral' }, '初始化…');
  const warning = h('div', { class: 'warning' });
  const speedValue = h('strong', { class: 'speed-value' }, '0.0');
  const speedBar = h('i', { class: 'speed-fill' });
  const ratioValue = h('span', {}, '—');
  const tubeValue = h('span', {}, '0.0s');
  const lipValue = h('span', {}, '—');
  const railMeter = h('i', { class: 'meter-fill rail' });
  const trimMeter = h('i', { class: 'meter-fill trim' });
  const forceList = h('div', { class: 'force-list' });
  const popupLayer = h('div', { class: 'popup-layer' });
  const countdown = h('div', { class: 'countdown' });
  const pauseOverlay = h('div', { class: 'overlay pause-overlay', hidden: true },
    h('div', { class: 'panel card' },
      h('h2', {}, '暂停'),
      h('p', {}, '浪和物理步进已冻结。'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => game.togglePause() }, '继续'),
        h('button', { class: 'btn secondary', onclick: () => game.restart() }, '重新开始'),
        h('a', { class: 'btn ghost', href: '#/spots' }, '换浪点'))));

  const reportLayer = h('div', { class: 'overlay report-overlay', hidden: true });

  hud.append(
    h('div', { class: 'hud-top' },
      h('div', { class: 'hud-spot card-glass' },
        h('a', { class: 'back-link', href: '#/spots' }, '← 浪点'),
        h('h1', {}, spot.name),
        h('p', {}, `${game.wave.hydro.breakerLabel} · ξ ${game.wave.hydro.iribarren.toFixed(2)} · c_b ${game.wave.hydro.breakSpeed.toFixed(1)} m/s`)),
      h('div', { class: 'hud-score card-glass' },
        h('span', { class: 'eyebrow' }, 'HEAT SCORE'),
        scoreValue,
        h('div', { class: 'hud-row' }, h('span', {}, '浪时 '), timeValue),
        h('div', { class: 'progress' }, progressFill)),
      h('div', { class: 'hud-actions' },
        h('button', { class: 'icon-btn', title: '暂停 P/Esc', onclick: () => game.togglePause() }, 'Ⅱ'),
        h('a', { class: 'icon-btn', title: '剖面讲解', href: `#/science/${spot.id}` }, 'i'),
        h('a', { class: 'icon-btn', title: '评分页', href: '#/judging' }, '★'))),
    h('div', { class: 'hud-left card-glass' },
      h('div', { class: 'speed-block' }, speedValue, h('span', {}, 'km/h')),
      h('div', { class: 'meter speed-meter' }, speedBar),
      h('div', { class: 'hud-data-grid' },
        h('span', {}, '最大'), h('strong', { id: 'max-speed' }, '0 km/h'),
        h('span', {}, '板/浪速比'), ratioValue,
        h('span', {}, '管浪'), tubeValue,
        h('span', {}, '卷唇间距'), lipValue),
      h('div', { class: 'stance-meters' },
        h('label', {}, '板缘', h('span', { class: 'meter' }, railMeter)),
        h('label', {}, '重心', h('span', { class: 'meter trim-meter-wrap' }, trimMeter)))),
    h('div', { class: 'hud-right card-glass' },
      h('h3', {}, '受力 / N'),
      forceList),
    zonePill,
    warning,
    popupLayer,
    countdown,
    pauseOverlay,
    reportLayer,
    createTouchControls(game),
    h('div', { class: 'controls-hint card-glass' },
      h('span', {}, 'A/D 或 ←/→ 压内缘转向'),
      h('span', {}, 'W/↑ 压前脚加速 · S/↓ 后脚减速'),
      h('span', {}, 'Space/J 起跳 · 空中 A/D 转体 · Shift/G 抓板'),
      h('span', {}, 'P/Esc 暂停 · R 重开')),
  );

  const popupNodes = new Map<number, HTMLDivElement>();

  function update(s: HudSnapshot) {
    scoreValue.textContent = s.score.toLocaleString();
    timeValue.textContent = formatTime(s.elapsed);
    progressFill.style.width = `${Math.round(s.progress * 100)}%`;
    speedValue.textContent = (s.speedKmh).toFixed(1);
    speedBar.style.width = `${Math.min(100, (s.speedKmh / 42) * 100)}%`;
    const maxEl = hud.querySelector('#max-speed');
    if (maxEl) maxEl.textContent = `${s.maxSpeedKmh.toFixed(1)} km/h`;
    ratioValue.textContent = `${s.speedRatio.toFixed(2)}× c_b`;
    ratioValue.className = s.speedRatio >= 0.65 && s.speedRatio <= 2.2 ? 'good-text' : 'warn-text';
    tubeValue.textContent = `${s.tubeTime.toFixed(1)}s`;
    lipValue.textContent = s.lipClearance > 50 ? '—' : `${s.lipClearance.toFixed(1)}m`;
    lipValue.className = s.lipClearance < 1.05 ? 'bad-text' : s.lipClearance < 1.5 ? 'warn-text' : '';

    zonePill.textContent = s.zone;
    zonePill.className = `zone-pill ${s.zoneTone}`;
    warning.textContent = s.warning;
    warning.classList.toggle('show', Boolean(s.warning));

    railMeter.style.transform = `translateX(${s.rail * 110}%)`;
    trimMeter.style.transform = `scaleX(${0.25 + Math.abs(s.trim) * 0.75})`;
    trimMeter.className = `meter-fill trim ${s.trim < -0.1 ? 'back' : s.trim > 0.1 ? 'front' : ''}`;

    updateForces(forceList, s);
    updatePopups(s, popupLayer, popupNodes);

    if (s.status === 'countdown') {
      countdown.hidden = false;
      const n = Math.ceil(s.countdown);
      countdown.innerHTML = `<div class="count-number">${n > 0 ? n : 'GO'}</div><p>跟着剥离的浪峰，沿 +Z 方向走</p>`;
    } else {
      countdown.hidden = true;
    }
    pauseOverlay.hidden = s.status !== 'paused';
  }

  function showReport(report: RunReport) {
    reportLayer.hidden = false;
    reportLayer.replaceChildren(
      h('div', { class: 'panel report-card card' },
        h('p', { class: 'eyebrow' }, 'RUN SENT TO JUDGING'),
        h('h2', {}, report.completed ? '浪段完成' : '本轮落水'),
        h('p', { class: 'report-reason' }, report.finishReason),
        h('div', { class: 'report-score' }, report.heatScore.toFixed(1), h('small', {}, '/ 10')),
        h('div', { class: 'report-grid' },
          reportMetric('总分', report.totalScore.toLocaleString()),
          reportMetric('最大速度', `${report.maxSpeedKmh.toFixed(1)} km/h`),
          reportMetric('浪速', `${report.waveSpeed.toFixed(1)} m/s`),
          reportMetric('速比', report.speedOrderRatio.toFixed(2)),
          reportMetric('管浪', `${report.tubeTime.toFixed(1)}s`),
          reportMetric('切转/腾空', `${report.turnCount}/${report.aerialCount}`)),
        h('p', { class: 'speed-check' }, report.speedOrderOk ? '✓ 板速与浪传播速度处于同一量级' : '⚠ 速度量级需要调参'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary', onclick: () => game.restart() }, '再来一轮'),
          h('a', { class: 'btn secondary', href: '#/judging' }, '查看比赛评分'),
          h('a', { class: 'btn ghost', href: `#/science/${spot.id}` }, '剖面讲解'))),
    );
  }

  return { update, showReport };
}

function reportMetric(label: string, value: string) {
  return h('div', { class: 'report-metric' }, h('span', {}, label), h('strong', {}, value));
}

function updateForces(container: HTMLElement, s: HudSnapshot) {
  const rows: [string, number, string][] = [
    ['重力', Math.hypot(s.forces.gravity.x, s.forces.gravity.y, s.forces.gravity.z), '#7cf7d4'],
    ['水流推力', s.forces.flowMagnitude, '#66e3ff'],
    ['板底升力', s.forces.liftMagnitude, '#b8ff5c'],
    ['尾舵侧力', s.forces.finMagnitude, '#ffd166'],
  ];
  if (!container.children.length) {
    for (const [label] of rows) {
      const row = h('div', { class: 'force-row' },
        h('span', {}, label),
        h('span', { class: 'force-bar' }, h('i')),
        h('strong', {}, '0'));
      container.append(row);
    }
  }
  Array.from(container.children).forEach((child, i) => {
    const [, mag, color] = rows[i];
    const bar = child.querySelector('i') as HTMLElement;
    const val = child.querySelector('strong') as HTMLElement;
    bar.style.width = `${Math.min(100, (mag / 1400) * 100)}%`;
    bar.style.background = color;
    val.textContent = `${Math.round(mag)}`;
  });
}

function updatePopups(s: HudSnapshot, layer: HTMLElement, nodes: Map<number, HTMLDivElement>) {
  const active = new Set(s.popups.map((p) => p.id));
  for (const popup of s.popups) {
    let node = nodes.get(popup.id);
    if (!node) {
      node = h('div', { class: `score-popup ${popup.kind}` },
        h('strong', {}, popup.title),
        h('span', {}, popup.detail),
        popup.points > 0 ? h('b', {}, `+${popup.points}`) : null);
      nodes.set(popup.id, node);
      layer.append(node);
    }
    node.style.opacity = String(Math.min(1, popup.ttl / 0.5));
    node.style.transform = `translateY(${Math.max(0, 2.8 - popup.ttl) * -18}px) scale(${0.96 + Math.min(0.04, popup.ttl * 0.02)})`;
  }
  for (const [id, node] of nodes) {
    if (!active.has(id)) {
      node.remove();
      nodes.delete(id);
    }
  }
}

function createTouchControls(game: SurfGame) {
  const bind = (action: 'left' | 'right' | 'drive' | 'brake' | 'jump' | 'grab', label: string, cls: string) => {
    const btn = h('button', { class: `touch-btn ${cls}`, 'aria-label': label }, label);
    const press = (e: Event) => {
      e.preventDefault();
      btn.setPointerCapture?.(e instanceof PointerEvent ? e.pointerId : 0);
      game.pressVirtual(action, true);
      btn.classList.add('pressed');
    };
    const release = (e: Event) => {
      e.preventDefault();
      game.pressVirtual(action, false);
      btn.classList.remove('pressed');
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
    return btn;
  };

  return h('div', { class: 'touch-controls' },
    h('div', { class: 'touch-left' }, bind('left', '◀', 'steer'), bind('right', '▶', 'steer')),
    h('div', { class: 'touch-right' },
      bind('grab', '抓', 'grab'),
      bind('brake', '后', 'trim'),
      bind('drive', '前', 'trim'),
      bind('jump', '跳', 'jump')));
}
