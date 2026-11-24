import { SPOTS } from '../../game/spots';
import { HYDRO } from '../../game/registry';
import { radToDeg } from '../../game/math';
import { difficultyDots, topNav } from '../components';
import { h } from '../dom';

export function renderSpots(root: HTMLElement) {
  root.append(
    topNav('spots'),
    h(
      'main',
      { class: 'page spots-page' },
      h(
        'section',
        { class: 'hero' },
        h('div', { class: 'hero-copy' },
          h('p', { class: 'eyebrow' }, 'WEBGL2 · TYPESCRIPT PHYSICS · IRIBAREN BREAKER MODEL'),
          h('h1', {}, '在移动浪壁上，找能量而不是追浪。'),
          h('p', { class: 'lead' },
            '浪从深水把周期和能量带到浅滩，海底坡度决定它是崩散、卷成管腔还是整片坍下。选一个浪点，压内缘转向、前后移重心、沿壁上下切速，并在卷唇之间完成动作。'),
          h('div', { class: 'hero-actions' },
            h('a', { class: 'btn primary big', href: '#/surf/green-islet' }, '直接进入青屿管湾'),
            h('a', { class: 'btn ghost big', href: '#/science/green-islet' }, '先看浪的剖面讲解')),
          h('div', { class: 'hero-facts' },
            h('span', {}, '✓ 伊里巴伦数分类'),
            h('span', {}, '✓ 破碎水深/浪高 = 0.70–0.90'),
            h('span', {}, '✓ 重力 / 水流 / 升力 / 尾舵力')),
        ),
        h('div', { class: 'hero-diagram', 'aria-hidden': 'true' },
          h('div', { class: 'diagram-wave' },
            h('div', { class: 'lip' }),
            h('div', { class: 'face' }),
            h('div', { class: 'board-dot' })),
          h('div', { class: 'diagram-caption' }, '靠前：冲浪脚 · 中间：能量口袋 · 管腔：高风险高分')),
      ),
      h('section', { class: 'spot-grid' }, ...SPOTS.map((spot) => createSpotCard(spot.id))),
      h('section', { class: 'physics-strip card' },
        h('div', {}, h('h2', {}, '本项目的两条硬约束')),
        h('div', { class: 'constraint' },
          h('strong', {}, '01 · 破碎类型不是贴标签'),
          h('p', {}, '每个浪点先由涌浪周期求 L₀，再由破碎点局部海底坡度 tanβ 和深水陡度 H₀/L₀ 计算 ξ = tanβ / √(H₀/L₀)，按阈值判定崩浪、卷浪、坍卷或涌碎。')),
        h('div', { class: 'constraint' },
          h('strong', {}, '02 · 破碎比例与板速量级'),
          h('p', {}, '搜索 H/h_m 达到破碎指数 γ 的位置，并把槽底起算的破碎水深/浪高也约束在 0.70–0.90；游戏内最大板速通常为浪速的 0.75–1.5 倍，而不是高出一个数量级。')),
      ),
    ),
  );
}

function createSpotCard(id: string) {
  const spot = SPOTS.find((s) => s.id === id)!;
  const hydro = HYDRO[id];
  const typeClass = hydro.breakerType;
  return h(
    'article',
    { class: `spot-card card ${typeClass}`, style: `--accent:${spot.palette.accent};--shallow:${spot.palette.shallow};--deep:${spot.palette.deep}` },
    h('div', { class: 'spot-visual' },
      h('div', { class: `mini-wave ${typeClass}` }),
      h('span', { class: `breaker-badge ${typeClass}` }, hydro.breakerLabel),
      h('span', { class: 'spot-region' }, spot.region)),
    h('div', { class: 'spot-body' },
      h('div', { class: 'spot-title-row' },
        h('div', {}, h('h2', {}, spot.name), h('p', { class: 'english' }, spot.englishName)),
        difficultyDots(spot.difficulty)),
      h('p', { class: 'tagline' }, spot.tagline),
      h('div', { class: 'spot-stats' },
        stat('涌浪 H/T', `${spot.swell.height.toFixed(1)}m / ${spot.swell.period.toFixed(1)}s`),
        stat('伊里巴伦 ξ', hydro.iribarren.toFixed(2), hydro.breakerEnglish),
        stat('破碎水深/浪高', hydro.depthToHeightRatio.toFixed(3), `槽底水深 ${hydro.breakDepth.toFixed(1)}m · H_b ${hydro.breakHeight.toFixed(1)}m`),
        stat('标准破碎指数', hydro.gamma.toFixed(3), `H_b / 平均水深 ${hydro.meanBreakDepth.toFixed(1)}m`),
        stat('浪速 c_b', `${hydro.breakSpeed.toFixed(1)}m/s`, `板速目标 ${hydro.expectedBoardSpeed[0].toFixed(0)}–${hydro.expectedBoardSpeed[1].toFixed(0)}`),
        stat('剥离速度', `${spot.peelSpeed.toFixed(1)}m/s`, spot.peelDirection > 0 ? '沿 +Z 卷过' : '沿 −Z 卷过')),
      h('div', { class: 'chip-row' }, ...spot.highlights.map((x) => h('span', { class: 'chip' }, x))),
      h('p', { class: 'spot-desc' }, spot.description),
      h('div', { class: 'spot-meta' },
        h('span', {}, `潮汐：${spot.bestTide}`),
        h('span', {}, `风：${spot.wind}`),
        h('span', {}, `风险：${spot.hazards.join('、')}`)),
      h('div', { class: 'card-actions' },
        h('a', { class: 'btn primary', href: `#/surf/${spot.id}` }, '进入冲浪'),
        h('a', { class: 'btn secondary', href: `#/science/${spot.id}` }, '剖面讲解'),
        h('a', { class: 'btn ghost judge-link', href: '#/judging' }, '评分页'))),
  );
}

function stat(label: string, value: string, hint?: string) {
  return h('div', { class: 'spot-stat' }, h('span', {}, label), h('strong', {}, value), hint ? h('small', {}, hint) : null);
}
