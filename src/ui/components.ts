import { h } from './dom';

export function topNav(active: 'spots' | 'science' | 'judging') {
  const link = (href: string, label: string, key: typeof active) =>
    h('a', { href, class: `nav-link ${active === key ? 'active' : ''}` }, label);
  return h(
    'header',
    { class: 'top-nav' },
    h('a', { class: 'brand', href: '#/spots' }, h('span', { class: 'brand-mark' }, '≈'), h('span', {}, 'LINEUP / 浪壁实验室')),
    h(
      'nav',
      { class: 'nav-links' },
      link('#/spots', '浪点选择', 'spots'),
      link('#/science/green-islet', '剖面讲解', 'science'),
      link('#/judging', '比赛评分', 'judging'),
    ),
  );
}

export function difficultyDots(level: number) {
  return h(
    'span',
    { class: 'difficulty', 'aria-label': `难度 ${level}/5` },
    ...Array.from({ length: 5 }, (_, i) => h('i', { class: i < level ? 'dot on' : 'dot' })),
  );
}

export function metric(label: string, value: string, hint?: string) {
  return h('div', { class: 'metric' }, h('span', { class: 'metric-label' }, label), h('strong', {}, value), hint ? h('small', {}, hint) : null);
}
