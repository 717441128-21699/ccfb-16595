import { SPOTS, getSpot } from '../../game/spots';
import { HYDRO } from '../../game/registry';
import { hydroAtDepth, depthAtOffshore } from '../../game/hydrodynamics';
import { clamp } from '../../game/math';
import { topNav } from '../components';
import { h } from '../dom';

export function renderScience(root: HTMLElement, spotId?: string): () => void {
  const spot = getSpot(spotId ?? 'green-islet');
  const hydro = HYDRO[spot.id];
  root.append(topNav('science'));

  const canvas = h('canvas', { class: 'science-canvas', width: 1040, height: 500, 'aria-label': '浪从深水到浅滩的剖面计算图' }) as HTMLCanvasElement;
  const scrub = h('input', { type: 'range', min: '0', max: '1000', value: '620', class: 'scrub' }) as HTMLInputElement;
  const readout = h('div', { class: 'scrub-readout' });
  const playBtn = h('button', { class: 'btn secondary' }, '暂停动画');
  let playing = true;
  let scrubValue = 0.62;

  scrub.addEventListener('input', () => {
    scrubValue = Number(scrub.value) / 1000;
    playing = false;
    playBtn.textContent = '播放传播';
    draw();
  });
  playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.textContent = playing ? '暂停动画' : '播放传播';
  });

  const page = h('main', { class: 'page science-page' },
    h('section', { class: 'science-header card' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'CROSS-SHORE PROFILE · SHOALING · IRIBAREN'),
        h('h1', {}, `${spot.name}：浪怎样从深水走到破碎`),
        h('p', { class: 'lead' }, spot.description)),
      h('div', { class: 'spot-switch' },
        ...SPOTS.map((s) => h('a', {
          class: `btn small ${s.id === spot.id ? 'primary' : 'ghost'}`,
          href: `#/science/${s.id}`,
        }, s.name)))),
    h('section', { class: 'science-grid' },
      h('div', { class: 'card diagram-card' },
        canvas,
        h('div', { class: 'diagram-controls' },
          playBtn,
          scrub,
          readout),
        legend()),
      h('aside', { class: 'science-side' },
        iribarrenCard(spot.id),
        ratioCard(spot.id),
        speedCard(spot.id),
        forceCard())),
    h('section', { class: 'card explanation-card' },
      h('h2', {}, '逐段理解这个剖面'),
      h('div', { class: 'explain-grid' },
        explain('1. 深水传播', `周期 T=${spot.swell.period}s 决定 L₀=gT²/2π=${hydro.deepWavelength.toFixed(1)}m，深水波速 c₀=${hydro.deepSpeed.toFixed(1)}m/s。此时海底还不能显著改造涌浪。`),
        explain('2. 色散与变浅', '进入有限水深后解 ω²=gk tanh(kh)，波长和波速下降，群速度改变。能量通量近似守恒，因此波高按 H=H₀√(c_g0/c_g) 的浅化系数增大。'),
        explain('3. 变陡与破碎', `局部坡度 tanβ=${hydro.breakSlope.toFixed(3)}，深水陡度 H₀/L₀=${hydro.steepness.toFixed(5)}，ξ=${hydro.iribarren.toFixed(2)}，所以分类为「${hydro.breakerLabel}」。`),
        explain('4. 板怎么获得能量', '重力沿浪壁切向拉板，浪面轨道流/Stokes 漂移对板产生推力；板底动水升力托住板，尾舵和板缘产生侧向力，把重力加速度变成切转而不是直冲岸边。'),
        explain('5. 管浪为什么高分', '卷浪的唇从浪峰抛出，形成移动空腔。理想路线贴着能量口袋和卷唇平行移动；离唇太近会扣落，离得太远则不被认定为管浪。'),
        explain('6. 速度量级', `破碎点波速 c_b=${hydro.breakSpeed.toFixed(1)}m/s。物理调参后的最大板速约 ${(hydro.breakSpeed * 0.8).toFixed(1)}–${(hydro.breakSpeed * 1.45).toFixed(1)}m/s，和浪速同为 m/s 的量级。`))),
  );
  root.append(page);

  let raf = 0;
  let phase = 0;
  let last = performance.now();
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (playing) {
      phase += dt * 1.7;
      scrubValue = (scrubValue + dt * 0.055) % 1;
      scrub.value = String(Math.round(scrubValue * 1000));
    }
    draw(phase);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function draw(animPhase = phase) {
    drawProfile(canvas, spot.id, scrubValue, animPhase, readout);
  }
  draw();

  return () => cancelAnimationFrame(raf);
}

function legend() {
  return h('div', { class: 'chart-legend' },
    h('span', {}, h('i', { class: 'legend seabed' }), '海床 / 海底地形'),
    h('span', {}, h('i', { class: 'legend envelope' }), '浅化波高包络'),
    h('span', {}, h('i', { class: 'legend wave' }), '动态浪面'),
    h('span', {}, h('i', { class: 'legend break' }), '破碎点与比例'));
}

function explain(title: string, text: string) {
  return h('article', { class: 'explain-item' }, h('h3', {}, title), h('p', {}, text));
}

function iribarrenCard(id: string) {
  const hydro = HYDRO[id];
  const pct = clamp((hydro.iribarren / 3.5) * 100, 2, 100);
  return h('div', { class: 'card calc-card' },
    h('p', { class: 'eyebrow' }, 'IRIBARREN NUMBER'),
    h('div', { class: 'big-formula' }, `ξ = ${hydro.iribarren.toFixed(2)}`),
    h('div', { class: 'xi-gauge' },
      h('i', { style: `left:${pct}%` }),
      h('div', { class: 'xi-ranges' }, h('span', {}, '崩 <.4'), h('span', {}, '卷 .4–2'), h('span', {}, '坍 2–3.2'), h('span', {}, '涌 >3.2'))),
    h('h3', { class: `breaker-title ${hydro.breakerType}` }, hydro.breakerLabel),
    h('p', {}, hydro.breakerEnglish),
    h('div', { class: 'formula-lines' },
      h('code', {}, `tanβ = ${hydro.breakSlope.toFixed(4)}`),
      h('code', {}, `√(H₀/L₀) = ${Math.sqrt(hydro.steepness).toFixed(4)}`)));
}

function ratioCard(id: string) {
  const hydro = HYDRO[id];
  return h('div', { class: 'card calc-card highlight-card' },
    h('p', { class: 'eyebrow' }, 'BREAKER DEPTH RATIO'),
    h('div', { class: 'ratio-row' },
      h('div', {}, h('strong', {}, hydro.depthToHeightRatio.toFixed(3)), h('span', {}, '破碎水深 / 浪高')),
      h('div', {}, h('strong', {}, hydro.heightToDepthRatio.toFixed(3)), h('span', {}, '浪高 / 平均水深 H_b/h_m'))),
    h('p', {}, `从前方碎波槽到海床量起：破碎水深 d_b=${hydro.breakDepth.toFixed(2)}m，浪高 H_b=${hydro.breakHeight.toFixed(2)}m，所以 d_b/H_b=${hydro.depthToHeightRatio.toFixed(3)}。若采用平均水面水深 h_m=${hydro.meanBreakDepth.toFixed(2)}m，标准破碎指数 H_b/h_m=${hydro.gamma.toFixed(3)}，两种比例都按 0.70–0.90 的破碎窗口选取。`),
    h('div', { class: 'range-pill good' }, '0.70 ≤ ratio ≤ 0.90 ✓'));
}

function speedCard(id: string) {
  const hydro = HYDRO[id];
  return h('div', { class: 'card calc-card' },
    h('p', { class: 'eyebrow' }, 'SPEED ORDER'),
    h('div', { class: 'ratio-row' },
      h('div', {}, h('strong', {}, `${hydro.breakSpeed.toFixed(1)}`), h('span', {}, 'c_b m/s')),
      h('div', {}, h('strong', {}, `${hydro.expectedBoardSpeed[1].toFixed(0)}`), h('span', {}, '板速上限 m/s'))),
    h('p', {}, `浅水近似 √(gh_b)=${hydro.shallowSpeed.toFixed(1)}m/s，与色散结果一致。游戏 HUD 会显示实时最大板速 / c_b；合理区间约 0.65–2.2。`));
}

function forceCard() {
  return h('div', { class: 'card calc-card' },
    h('p', { class: 'eyebrow' }, 'BOARD FORCES'),
    h('ul', { class: 'force-explain' },
      h('li', {}, h('b', {}, '重力'), '：沿浪壁切向分量负责下坡加速。'),
      h('li', {}, h('b', {}, '水流推力'), '：F=½ρC_DA|u−v|(u−v)，浪面轨道流比板快时即为推力。'),
      h('li', {}, h('b', {}, '板底升力'), '：F_L=½ρv²A C_L，方向沿压缘后的板底法线。'),
      h('li', {}, h('b', {}, '尾舵侧力'), '：由舵角和侧滑角共同决定，把速度矢量拉向板首方向。')));
}

function drawProfile(canvas: HTMLCanvasElement, spotId: string, scrub: number, phase: number, readout: HTMLElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || 1040;
  const cssH = 500;
  if (canvas.width !== Math.floor(cssW * dpr)) {
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW;
  const H = cssH;
  ctx.clearRect(0, 0, W, H);

  const spot = getSpot(spotId);
  const data = HYDRO[spotId];
  const sMax = 220;
  const padL = 58;
  const padR = 28;
  const plotW = W - padL - padR;
  const mwlY = 178;
  const vScale = 10.5;
  const x = (s: number) => padL + ((sMax - clamp(s, 0, sMax)) / sMax) * plotW;
  const yDepth = (depth: number) => mwlY + depth * vScale;
  const yElev = (elev: number) => mwlY - elev * vScale;

  // Background bands.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b2a43');
  bg.addColorStop(0.42, '#12617d');
  bg.addColorStop(0.43, '#0b3b55');
  bg.addColorStop(1, '#071d2e');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, W, H, 18);
  ctx.fill();

  // Grid and depth axis.
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.fillStyle = 'rgba(235,250,255,.72)';
  ctx.font = '12px system-ui';
  ctx.lineWidth = 1;
  for (let d = 0; d <= 16; d += 4) {
    const y = yDepth(d);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillText(`${d}m`, 18, y + 4);
  }
  for (const s of [0, 40, 80, 120, 160, 220]) {
    const xx = x(s);
    ctx.beginPath(); ctx.moveTo(xx, 70); ctx.lineTo(xx, H - 54); ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.stroke();
    ctx.fillStyle = 'rgba(235,250,255,.65)';
    ctx.fillText(s === 0 ? '岸线' : `${s}m`, xx - 14, H - 28);
  }
  ctx.fillStyle = 'rgba(235,250,255,.8)';
  ctx.fillText('外海 / 深水 ←', padL, 42);
  ctx.fillText('→ 岸边', W - padR - 52, 42);

  // Seabed.
  ctx.beginPath();
  ctx.moveTo(x(sMax), H - 40);
  for (let s = sMax; s >= 0; s -= 2) ctx.lineTo(x(s), yDepth(depthAtOffshore(spot, s)));
  ctx.lineTo(x(0), H - 40);
  ctx.closePath();
  const sand = ctx.createLinearGradient(0, mwlY, 0, H);
  sand.addColorStop(0, 'rgba(214,190,126,.95)');
  sand.addColorStop(1, 'rgba(87,70,48,.98)');
  ctx.fillStyle = sand;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,239,190,.8)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Mean water line.
  ctx.strokeStyle = 'rgba(190,245,255,.55)';
  ctx.setLineDash([7, 7]);
  ctx.beginPath(); ctx.moveTo(padL, mwlY); ctx.lineTo(W - padR, mwlY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(220,250,255,.8)';
  ctx.fillText('平均水面 MWL', W - padR - 112, mwlY - 8);

  // Height envelope from computed samples.
  const sampleAt = (s: number) => {
    const depth = depthAtOffshore(spot, s);
    const h = hydroAtDepth(spot.swell.height, spot.swell.period, depth);
    return { depth, H: spot.swell.height * h.shoal, wavelength: h.wavelength, speed: h.speed };
  };

  ctx.beginPath();
  for (let s = sMax; s >= 2; s -= 2) {
    const q = sampleAt(s);
    const xx = x(s);
    const yy = yElev(q.H / 2);
    if (s === sMax) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
  }
  ctx.strokeStyle = 'rgba(184,255,92,.72)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  for (let s = sMax; s >= 2; s -= 2) {
    const q = sampleAt(s);
    const xx = x(s);
    const yy = yElev(-q.H / 2);
    if (s === sMax) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
  }
  ctx.strokeStyle = 'rgba(184,255,92,.32)';
  ctx.stroke();

  // Animated surface with locally accumulated phase.
  ctx.beginPath();
  let accumulated = 0;
  let prevS = sMax;
  for (let s = sMax; s >= 2; s -= 1.5) {
    const q = sampleAt(s);
    accumulated += ((prevS - s) * 2 * Math.PI) / Math.max(18, q.wavelength);
    prevS = s;
    const eta = (q.H / 2) * Math.sin(accumulated * 1.15 - phase * 2.2);
    const xx = x(s);
    const yy = yElev(eta);
    if (s === sMax) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
  }
  ctx.strokeStyle = '#eaffff';
  ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(124,247,212,.8)';
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Break marker.
  const bx = x(data.breakOffshore);
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([9, 6]);
  ctx.beginPath(); ctx.moveTo(bx, 76); ctx.lineTo(bx, H - 50); ctx.stroke();
  ctx.setLineDash([]);
  drawBreakGlyph(ctx, bx, yElev(data.breakHeight / 2), data.breakerType);
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 14px system-ui';
  ctx.fillText(`破碎点 ξ=${data.iribarren.toFixed(2)}`, bx + 10, 88);
  ctx.font = '12px system-ui';
  ctx.fillText(`h_m=${data.meanBreakDepth.toFixed(2)}m  H_b=${data.breakHeight.toFixed(2)}m  d_b/H=${data.depthToHeightRatio.toFixed(3)}`, bx + 10, 108);

  // Scrub probe.
  const probeS = sMax * (1 - scrub);
  const probe = sampleAt(probeS);
  const px = x(probeS);
  ctx.strokeStyle = '#7cf7d4';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(px, 70); ctx.lineTo(px, H - 54); ctx.stroke();
  ctx.fillStyle = '#7cf7d4';
  ctx.beginPath(); ctx.arc(px, yDepth(probe.depth), 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(px, yElev(probe.H / 2), 5, 0, Math.PI * 2); ctx.fill();

  const stage = probeS > data.breakOffshore + 45 ? '深水 / 浅化' : Math.abs(probeS - data.breakOffshore) < 45 ? '破碎临界' : '破碎后 / 冲岸';
  readout.innerHTML = `
    <strong>${stage}</strong>
    <span>离岸距离 ${probeS.toFixed(0)} m</span>
    <span>水深 ${probe.depth.toFixed(1)} m</span>
    <span>波高 ${probe.H.toFixed(2)} m</span>
    <span>波速 ${probe.speed.toFixed(1)} m/s</span>
    <span>L=${probe.wavelength.toFixed(0)} m</span>`;
}

function drawBreakGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, type: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (type === 'spilling') {
    ctx.moveTo(-34, 24); ctx.quadraticCurveTo(-8, -28, 34, 18);
    ctx.moveTo(-4, -8); ctx.quadraticCurveTo(10, 4, 28, 8);
  } else if (type === 'plunging') {
    ctx.moveTo(-42, 26);
    ctx.quadraticCurveTo(-24, -42, 18, -20);
    ctx.quadraticCurveTo(48, -2, 22, 22);
    ctx.quadraticCurveTo(8, 34, -4, 18);
  } else {
    ctx.moveTo(-38, 24); ctx.lineTo(-8, -24); ctx.lineTo(18, -8); ctx.lineTo(36, 20);
  }
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
