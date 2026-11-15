import app from 'flarum/forum/app';

export const EXT = 'ernestdefoe-glimpse';

/** A forum string from our locale. */
export const t = (key: string, params: Record<string, unknown> = {}) => app.translator.trans(`${EXT}.forum.${key}`, params);

/** The same, as plain text (for attributes, titles and aria labels). */
export const tx = (key: string, params: Record<string, unknown> = {}): string =>
  app.translator.trans(`${EXT}.forum.${key}`, params, true) as unknown as string;

export const has = (extension: string): boolean => extension in ((globalThis as any).flarum?.extensions || {});

/** Everything that changes stories (posting, deleting, a moderator's decision) calls this, and the bar reloads. */
const listeners = new Set<() => void>();
export function onStoriesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function storiesChanged(): void {
  listeners.forEach((listener) => listener());
}

/** The viewer, the create sheet, the pages and the modals: one lazy chunk, fetched on first use. */
export const ui = () => import('./ui');
