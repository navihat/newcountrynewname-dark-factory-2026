import { el, replaceChildren } from './dom.js';

export type NoticeKind = 'error' | 'uncertain' | 'success' | 'info';

export interface NoticeSlot {
  element: HTMLElement;
  show(kind: NoticeKind, testid: string, text: string): void;
  clear(): void;
}

/** A place for one message at a time; the message element exists only while it is shown. */
export function noticeSlot(): NoticeSlot {
  const element = el('div', { class: 'notice-slot' });
  return {
    element,
    show(kind, testid, text) {
      const role = kind === 'error' ? 'alert' : 'status';
      replaceChildren(element, [el('p', { class: `notice notice-${kind}`, testid, role, text })]);
    },
    clear() {
      replaceChildren(element, []);
    },
  };
}
