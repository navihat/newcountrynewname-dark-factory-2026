export type Child = Node | string | null | undefined | false;
export type Attrs = Record<string, string | boolean | undefined>;

/** Tiny element builder. `testid` becomes data-testid; `text` sets the text content. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (name === 'testid') node.setAttribute('data-testid', String(value));
    else if (name === 'text') node.textContent = String(value);
    else node.setAttribute(name, value === true ? '' : value);
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function replaceChildren(parent: Node, children: Child[]): void {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  append(parent, children);
}

let fieldCounter = 0;

/** A labelled form field; the label is tied to the control by id. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  if (!control.id) control.id = `field-${++fieldCounter}`;
  return el(
    'div',
    { class: 'field' },
    el('label', { for: control.id, text: label }),
    control,
    hint ? el('p', { class: 'hint', text: hint }) : null,
  );
}

export function visibilitySelect(testid: string): HTMLSelectElement {
  const select = el('select', { testid, name: 'visibility' });
  select.append(
    el('option', { value: 'public', text: 'Public: visible in the activity feed' }),
    el('option', { value: 'private', text: 'Private: only you and the recipient' }),
  );
  return select;
}
