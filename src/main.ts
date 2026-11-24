import './styles.css';
import { h, parseHash } from './ui/dom';
import { renderSpots } from './ui/pages/spots';
import { renderSurf } from './ui/pages/surf';
import { renderScience } from './ui/pages/science';
import { renderJudging } from './ui/pages/judging';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');
const rootElement: HTMLDivElement = app;

let cleanup: (() => void) | undefined;

function renderRoute() {
  cleanup?.();
  cleanup = undefined;
  rootElement.replaceChildren();
  const route = parseHash();

  if (route.name === 'surf') {
    const page = h('div', { class: 'route route-surf' });
    rootElement.append(page);
    cleanup = renderSurf(page, route.param);
    window.scrollTo(0, 0);
    return;
  }

  const page = h('div', { class: 'route' });
  rootElement.append(page);

  if (route.name === 'science') cleanup = renderScience(page, route.param);
  else if (route.name === 'judging') cleanup = renderJudging(page);
  else renderSpots(page);

  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', renderRoute);
renderRoute();
