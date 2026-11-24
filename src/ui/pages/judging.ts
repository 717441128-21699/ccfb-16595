import { loadReports, clearReports } from '../../game/storage';
import type { RunReport } from '../../game/Scoring';
import { SPOTS } from '../../game/spots';
import { topNav } from '../components';
import { h } from '../dom';

export function renderJudging(root: HTMLElement): () => void {
  root.append(topNav('judging'));
  const main = h('main', { class: 'page judging-page' });
  root.append(main);

  let reports = loadReports();
  let selectedId = reports[0]?.id;

  function render() {
    reports = loadReports();
    if (!reports.some((r) => r.id === selectedId)) selectedId = reports[0]?.id;
    const report = reports.find((r) => r.id === selectedId) ?? null;
    main.replaceChildren(
      h('section', { class: 'judging-hero card' },
        h('div', {},
          h('p', { class: 'eyebrow' }, 'CONTEST JUDGING · 5 PANEL · BEST TWO WAVES'),
          h('h1', {}, '比赛评分台'),
          h('p', { class: 'lead' }, '动作分、管浪投入、速度力量和流畅度会转成 0–10 分裁判卡。正式预赛通常取每场 heat 中最好的两道浪；这里取你本地记录中最高的两次。')),
        h('div', { class: 'hero-actions' },
          h('a', { class: 'btn primary big', href: '#/spots' }, '去比一轮'),
          report ? h('a', { class: 'btn secondary big', href: `#/surf/${report.spotId}` }, '重赛该浪点') : null)),
      h('section', { class: 'judging-grid' },
        h('div', { class: 'scorecard-column' }, report ? scorecard(report) : emptyScorecard(), criteriaCard(report)),
        h('aside', { class: 'judging-side' }, heatCard(reports), historyCard(reports, selectedId, (id) => { selectedId = id; render(); }))),
    );
  }

  render();
  return () => undefined;
}

function emptyScorecard() {
  return h('div', { class: 'card scorecard empty-scorecard' },
    h('div', { class: 'empty-score' }, '—.—'),
    h('h2', {}, '还没有送评浪段'),
    h('p', {}, '完成一次冲浪，或在落水后等待 2 秒，系统会自动把裁判分保存到本机。'),
    h('div', { class: 'rubric-preview' },
      h('div', {}, h('strong', {}, '管浪 / 投入'), h('span', {}, '管腔时间、与卷唇的安全距离')),
      h('div', {}, h('strong', {}, '难度'), h('span', {}, '浪点 ξ、海底地形、腾空和转体')),
      h('div', {}, h('strong', {}, '速度 / 力量'), h('span', {}, '最大板速与浪速比、侧向 G')),
      h('div', {}, h('strong', {}, '流畅 / 完成度'), h('span', {}, '路线、落地质量、是否完浪'))),
    h('a', { class: 'btn primary', href: '#/surf/green-islet' }, '立即试滑青屿管湾'));
}

function scorecard(report: RunReport) {
  return h('article', { class: 'card scorecard' },
    h('header', { class: 'scorecard-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, report.spotName),
        h('h2', {}, report.completed ? '完成浪段记分卡' : '落水浪段记分卡'),
        h('p', { class: 'muted' }, `${new Date(report.createdAt).toLocaleString('zh-CN')} · ξ ${report.iribarren.toFixed(2)} · ${report.breakerLabel}`)),
      h('div', { class: `big-heat-score ${report.heatScore >= 8 ? 'excellent' : report.heatScore >= 6 ? 'good' : ''}` },
        report.heatScore.toFixed(1), h('small', {}, '/10'))),
    h('div', { class: 'judges-grid' }, ...report.judges.map((j) =>
      h('div', { class: 'judge-card' },
        h('div', { class: 'judge-top' }, h('strong', {}, j.judge), h('span', {}, j.country)),
        h('b', {}, j.score.toFixed(1)),
        h('p', {}, j.comment)))),
    h('div', { class: 'score-metrics' },
      metric('游戏动作分', report.totalScore.toLocaleString()),
      metric('最大速度', `${report.maxSpeedKmh.toFixed(1)} km/h`),
      metric('板/浪速比', report.speedOrderRatio.toFixed(2)),
      metric('管浪时间', `${report.tubeTime.toFixed(1)} s`),
      metric('切转', String(report.turnCount)),
      metric('腾空', String(report.aerialCount)),
      metric('距离', `${report.distance.toFixed(0)} m`),
      metric('最大侧向 G', report.maxLateralG.toFixed(2))),
    h('div', { class: `speed-verdict ${report.speedOrderOk ? 'good' : 'warn'}` },
      report.speedOrderOk ? `✓ 最大板速 ${report.maxSpeed.toFixed(1)} m/s，浪速 ${report.waveSpeed.toFixed(1)} m/s，处于同一量级。` : '⚠ 板速/浪速比例超出预期。'),
    h('h3', { class: 'tricks-title' }, '动作明细'),
    report.tricks.length
      ? h('div', { class: 'trick-list' }, ...report.tricks.slice(0, 12).map((t) =>
          h('div', { class: `trick-row ${t.kind}` },
            h('div', {}, h('strong', {}, t.name), h('span', {}, t.detail)),
            h('div', { class: 'trick-right' },
              h('span', { class: 'completion' }, `${Math.round(t.completion * 100)}%`),
              h('b', {}, `+${t.points}`)))))
      : h('p', { class: 'muted' }, '没有识别到超过最低角度/完成度的动作。试试按住 D/A 完成一次 90° 以上切转，或 Space 起跳后平稳落地。'));
}

function criteriaCard(report: RunReport | null) {
  const criteria = report?.criteria ?? [
    { label: '投入 / 管浪', score: 0, note: '尚未滑行' },
    { label: '难度', score: 0, note: '—' },
    { label: '创新 / 腾空', score: 0, note: '—' },
    { label: '变化 / 动作组合', score: 0, note: '—' },
    { label: '速度 / 力量', score: 0, note: '—' },
    { label: '流畅 / 完浪', score: 0, note: '—' },
  ];
  return h('article', { class: 'card criteria-card' },
    h('h2', {}, '评分维度'),
    ...criteria.map((c) =>
      h('div', { class: 'criterion' },
        h('div', { class: 'criterion-head' }, h('span', {}, c.label), h('strong', {}, report ? c.score.toFixed(1) : '—')),
        h('div', { class: 'criterion-bar' }, h('i', { style: `width:${report ? c.score * 10 : 0}%` })),
        h('small', {}, c.note))));
}

function heatCard(reports: RunReport[]) {
  const bestTwo = reports.map((r) => r.heatScore).sort((a, b) => b - a).slice(0, 2);
  const playerTotal = bestTwo.reduce((a, b) => a + b, 0);
  const rivals = [
    { name: 'Kai M.', country: 'HAW', scores: [8.8, 8.2] },
    { name: 'Sofia R.', country: 'PRT', scores: [7.9, 8.4] },
    { name: '丸山 渚', country: 'JPN', scores: [7.6, 7.8] },
    { name: 'Ari T.', country: 'AUS', scores: [6.9, 7.5] },
  ].map((r) => ({ ...r, total: r.scores.reduce((a, b) => a + b, 0) }));
  const rows = [
    { name: '你 / PLAYER', country: '---', total: bestTwo.length ? playerTotal : null, scores: bestTwo },
    ...rivals,
  ].sort((a, b) => (b.total ?? -1) - (a.total ?? -1));

  return h('article', { class: 'card heat-card' },
    h('p', { class: 'eyebrow' }, 'CURRENT HEAT'),
    h('h2', {}, 'Heat 排名 · 最好两道浪'),
    h('div', { class: 'leaderboard' },
      ...rows.map((r, i) => h('div', { class: `leader-row ${r.name.startsWith('你') ? 'player' : ''}` },
        h('b', { class: 'rank' }, String(i + 1)),
        h('div', { class: 'leader-name' }, h('strong', {}, r.name), h('span', {}, r.country)),
        h('div', { class: 'wave-scores' },
          h('span', {}, r.scores[0]?.toFixed(1) ?? '—'),
          h('span', {}, r.scores[1]?.toFixed(1) ?? '—')),
        h('strong', { class: 'total' }, r.total === null ? '—' : r.total.toFixed(1))))),
    h('p', { class: 'muted' }, '虚拟选手成绩用于展示比赛排名；你的分数来自本机真实物理回合。'));
}

function historyCard(reports: RunReport[], selectedId: string | undefined, onSelect: (id: string) => void) {
  return h('article', { class: 'card history-card' },
    h('div', { class: 'history-head' }, h('h2', {}, '本地浪段'), h('button', {
      class: 'btn tiny ghost danger',
      onclick: () => {
        if (confirm('确定清空本机评分记录？')) {
          clearReports();
          location.hash = '#/judging';
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        }
      },
    }, '清空')),
    reports.length
      ? h('div', { class: 'history-list' }, ...reports.slice(0, 12).map((r) =>
          h('button', {
            class: `history-item ${r.id === selectedId ? 'active' : ''}`,
            onclick: () => onSelect(r.id),
          },
            h('div', {}, h('strong', {}, r.spotName), h('span', {}, new Date(r.createdAt).toLocaleString('zh-CN'))),
            h('b', {}, r.heatScore.toFixed(1)))))
      : h('div', { class: 'empty-history' },
          h('p', {}, '暂无记录。')),
    h('div', { class: 'history-spots' },
      ...SPOTS.slice(0, 4).map((s) => h('a', { class: 'chip-link', href: `#/surf/${s.id}` }, s.name))));
}

function metric(label: string, value: string) {
  return h('div', { class: 'score-metric' }, h('span', {}, label), h('strong', {}, value));
}
