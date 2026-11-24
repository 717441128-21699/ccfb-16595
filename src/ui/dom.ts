export type HtmlChild = Node | string | number | false | null | undefined;
export type HtmlProps<T extends HTMLElement> = Partial<Omit<T, 'style'>> & {
  class?: string;
  style?: string | Partial<CSSStyleDeclaration>;
  dataset?: Record<string, string>;
} & { [attribute: `aria-${string}`]: string | number | boolean | undefined };

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: HtmlProps<HTMLElementTagNameMap[K]> = {},
  ...children: HtmlChild[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') element.className = String(value);
    else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value as Record<string, string>)) element.dataset[dk] = dv;
    } else if (key === 'style') {
      if (typeof value === 'string') element.style.cssText = value;
      else Object.assign(element.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key.includes('-') || key.startsWith('aria-') || key === 'role') {
      element.setAttribute(key, String(value));
    } else {
      (element as unknown as Record<string, unknown>)[key] = value;
    }
  }
  for (const child of children.flat()) {
    if (child === false || child === null || child === undefined) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

export function clear(element: HTMLElement) {
  element.replaceChildren();
}

export function route(path: string) {
  window.location.hash = path;
}

export function parseHash(): { name: string; param?: string } {
  const raw = window.location.hash.replace(/^#/, '') || '/spots';
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] === 'surf' || parts[0] === 'science') return { name: parts[0], param: parts[1] };
  if (parts[0] === 'judging') return { name: 'judging' };
  return { name: 'spots' };
}
