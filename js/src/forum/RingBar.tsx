import app from 'flarum/forum/app';
import Component, { type ComponentAttrs } from 'flarum/common/Component';
import Avatar from 'flarum/common/components/Avatar';
import Link from 'flarum/common/components/Link';
import classList from 'flarum/common/utils/classList';
import type User from 'flarum/common/models/User';
import type Mithril from 'mithril';
import type Story from './models/Story';
import { failed, onStoriesChanged, t, tx, ui } from './util';

export interface Ring {
  user: User;
  stories: Story[];
  unseen: boolean;
  followed: boolean;
  latest: number;
}

/** The bar's data, shared by every bar on the page (the index, a widget), loaded with one request. */
export const bar = {
  rings: [] as Ring[],
  mine: [] as Story[],
  loaded: false,
  loading: null as Promise<void> | null,

  load(): Promise<void> {
    this.loading ??= app.store
      .find<Story[]>('stories', { filter: { bar: '1' }, page: { limit: 100, total: 0 } } as any)
      .then((stories) => this.group(stories as Story[]))
      .catch(failed)
      .finally(() => {
        this.loaded = true;
        this.loading = null;
        m.redraw();
      });

    return this.loading;
  },

  group(stories: Story[]): void {
    const me = app.session.user;
    const byAuthor = new Map<string, Ring>();
    this.mine = [];

    stories.forEach((story) => {
      const user = story.user();
      if (!user) return;
      if (me && user === me) {
        this.mine.push(story);
        return;
      }
      const ring = byAuthor.get(user.id()!) || { user, stories: [], unseen: false, followed: story.authorFollowed(), latest: 0 };
      ring.stories.push(story);
      ring.latest = Math.max(ring.latest, story.createdAt()?.getTime() || 0);
      byAuthor.set(user.id()!, ring);
    });

    this.rings = [...byAuthor.values()];
    this.mine.sort((a, b) => (a.createdAt()?.getTime() || 0) - (b.createdAt()?.getTime() || 0));
  },

  /** The ring order: unseen first, then people you follow, then newest; or simply newest (admin's choice). */
  ordered(): Ring[] {
    this.rings.forEach((ring) => (ring.unseen = ring.stories.some((story) => !story.isSeen())));
    const smart = app.forum.attribute('glimpseBarOrder') !== 'newest';

    return [...this.rings].sort((a, b) => {
      if (smart && a.unseen !== b.unseen) return a.unseen ? -1 : 1;
      if (smart && a.followed !== b.followed) return a.followed ? -1 : 1;
      return b.latest - a.latest;
    });
  },
};

onStoriesChanged(() => bar.load());

export interface RingBarAttrs extends ComponentAttrs {
  /** A smaller row without the heading, for widget hosts. */
  compact?: boolean;
}

/**
 * The row of avatar rings. Unseen rings have the gradient, seen ones are grey; your own ring comes
 * first, with a plus to add a story. A ring opens the viewer (a lazy chunk) on that person.
 */
export default class RingBar extends Component<RingBarAttrs> {
  oninit(vnode: Mithril.Vnode<RingBarAttrs, this>) {
    super.oninit(vnode);
    if (!bar.loaded) bar.load();
  }

  view() {
    const canCreate = !!app.forum.attribute('glimpseCanCreate');
    const rings = bar.ordered();
    const me = app.session.user;

    if (bar.loaded && !rings.length && !bar.mine.length && !canCreate) return null;

    return (
      <section className={classList('GlimpseBar', this.attrs.compact && 'GlimpseBar--compact')} aria-label={tx('bar.label')}>
        {this.attrs.compact ? null : (
          <div className="GlimpseBar-head">
            <h2 className="GlimpseBar-title">{t('bar.title')}</h2>
            <Link className="GlimpseBar-all" href={app.route('glimpse.stories')}>
              {t('bar.see_all')}
            </Link>
          </div>
        )}
        <ul className="GlimpseBar-rings">
          {me && (canCreate || bar.mine.length) ? (
            <li className="GlimpseBar-item">
              <button
                type="button"
                className={classList('GlimpseRing', !bar.mine.length && 'GlimpseRing--empty')}
                aria-label={bar.mine.length ? tx('bar.your_story') : tx('bar.add')}
                onclick={() => (bar.mine.length ? this.openMine() : ui().then((chunk) => chunk.openCreate()))}
              >
                <span className="GlimpseRing-avatar">
                  <Avatar user={me} />
                </span>
              </button>
              {canCreate && bar.mine.length ? (
                // A sibling, not inside the ring: a button can't hold another button.
                <button
                  type="button"
                  className="GlimpseRing-plus"
                  aria-label={tx('bar.add')}
                  onclick={() => ui().then((chunk) => chunk.openCreate())}
                >
                  <i className="fas fa-plus" aria-hidden="true" />
                </button>
              ) : canCreate ? (
                <span className="GlimpseRing-plus" aria-hidden="true">
                  <i className="fas fa-plus" />
                </span>
              ) : null}
              <span className="GlimpseRing-name">{t('bar.your_story')}</span>
            </li>
          ) : null}
          {rings.map((ring) => (
            <li className="GlimpseBar-item">
              <button
                type="button"
                className={classList('GlimpseRing', !ring.unseen && 'GlimpseRing--seen')}
                aria-label={tx(ring.unseen ? 'bar.ring_new' : 'bar.ring_seen', { name: ring.user.displayName() })}
                onclick={() => this.open(rings, ring)}
              >
                <span className="GlimpseRing-avatar">
                  <Avatar user={ring.user} />
                </span>
              </button>
              <span className={classList('GlimpseRing-name', !ring.unseen && 'GlimpseRing-name--seen')}>{ring.user.displayName()}</span>
            </li>
          ))}
          {!bar.loaded ? <li className="GlimpseBar-item GlimpseBar-item--loading" aria-hidden="true" /> : null}
        </ul>
      </section>
    );
  }

  open(rings: Ring[], ring: Ring): void {
    ui().then((chunk) => chunk.openViewer({ users: rings.map((r) => r.user), start: ring.user }));
  }

  openMine(): void {
    const me = app.session.user;
    if (me) ui().then((chunk) => chunk.openViewer({ users: [me], start: me, stories: bar.mine }));
  }
}
