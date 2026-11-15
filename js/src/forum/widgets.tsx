import app from 'flarum/forum/app';
import RingBar from './RingBar';
import { EXT } from './util';

/*
 * The ring bar offered to every widget host that is present: fof/forum-widgets-core, Bespoke and Page
 * Builder. None is a build-time import; each is found at runtime, so forum.js is the same with all
 * three installed or none. FoF and Page Builder are optional dependencies in composer.json, so their
 * initializers have run before ours.
 */

const KEY = 'glimpseBar';
const TYPE = 'glimpse-bar';
const TITLE = `${EXT}.forum.widget.title`;
const ICON = 'fas fa-circle-play';

const widget = { view: () => <RingBar compact /> };

export function registerWidgets(): void {
  for (const register of [registerFof, registerBespoke, registerPageBuilder]) {
    try {
      register();
    } catch (e) {
      // A host whose internals moved must not take the forum down with it.
      console.warn('[glimpse] widget host registration failed', e);
    }
  }
}

/** A module of fof/forum-widgets-core, looked up at runtime. */
function fof(path: string): any {
  const mod = (globalThis as any).flarum?.reg?.get?.('fof-forum-widgets-core', path);
  return mod?.default ?? mod;
}

function registerFof(): void {
  const Widgets = fof('common/extend/Widgets');
  const WidgetBase = fof('common/components/Widget');
  if (!Widgets || !WidgetBase || !(app as any).widgets) return;

  class GlimpseFofWidget extends WidgetBase {
    className() {
      return 'GlimpseFofWidget';
    }
    icon() {
      return ICON;
    }
    title() {
      return app.translator.trans(TITLE);
    }
    content() {
      return <RingBar compact />;
    }
  }

  new Widgets()
    .add({
      key: KEY,
      component: GlimpseFofWidget,
      // Opt-in: shown only where the admin placed it in FoF's layout editor.
      isDisabled: () => !((app as any).widgets?.config?.instances || []).some((i: any) => i?.id === `${EXT}:${KEY}`),
      isUnique: true,
      placement: 'top',
      position: 0,
    })
    .extend(app, EXT);
}

function registerBespoke(): void {
  if (!('ernestdefoe-bespoke' in ((globalThis as any).flarum?.extensions || {}))) return;
  // Bespoke drains this queue on every registry lookup; labels are keys (it calls string methods on them).
  const queue = ((globalThis as any).BespokeWidgetQueue ||= []);
  queue.push({ type: TYPE, label: TITLE, icon: ICON, zones: ['hero', 'top', 'above-list', 'below-list'], schema: [], component: widget });
}

function registerPageBuilder(): void {
  // Page Builder drains this queue on every lookup; matches Widget\StoriesBlock::type().
  const queue = ((globalThis as any).PageBuilderBlockQueue ||= []);
  queue.push({ type: TYPE, component: widget });
}
