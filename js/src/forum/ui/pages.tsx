import app from 'flarum/forum/app';
import Page from 'flarum/common/components/Page';
import Avatar from 'flarum/common/components/Avatar';
import Button from 'flarum/common/components/Button';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import classList from 'flarum/common/utils/classList';
import humanTime from 'flarum/common/helpers/humanTime';
import type User from 'flarum/common/models/User';
import type Mithril from 'mithril';
import type Story from '../models/Story';
import type StoryHighlight from '../models/StoryHighlight';
import type StoryReport from '../models/StoryReport';
import { failed, onStoriesChanged, storiesChanged, t, tx } from '../util';
import { IndexSidebar, PageStructure } from './core';
import { openViewer } from './Viewer';
import { openCreate } from './open';

declare const flarum: any;

const PAGE = 24;

/** A 9:16 card: the photo, the first frame of a video, or the text on its colour, with the author. */
export function storyCard(story: Story, onopen: () => void, footer?: Mithril.Children): Mithril.Children {
  const user = story.user();
  return (
    <article className={classList('GlimpseCard', story.isSeen() && 'is-seen')}>
      <button type="button" className="GlimpseCard-open" onclick={onopen} aria-label={tx('page.open', { name: user ? user.displayName() : '' })}>
        <span className={classList('GlimpseCard-media', story.kind() === 'text' && `GlimpseText GlimpseBg-${story.background() ?? 0}`)}>
          {story.kind() === 'text' ? (
            <span className="GlimpseText-body">{story.text()}</span>
          ) : story.kind() === 'video' ? (
            <video src={`${story.mediaUrl()}#t=0.1`} preload="metadata" muted playsinline aria-hidden="true" />
          ) : (
            <img src={story.mediaUrl()!} alt="" loading="lazy" decoding="async" />
          )}
        </span>
        {story.kind() === 'video' && story.durationMs() ? (
          <span className="GlimpseCard-duration">
            <i className="fas fa-play" aria-hidden="true" /> {Math.round((story.durationMs() || 0) / 1000)}s
          </span>
        ) : null}
        {user ? (
          <span className="GlimpseCard-who">
            <Avatar user={user} />
            <span>
              <span className="GlimpseCard-name">{user.displayName()}</span>
              <span className="GlimpseCard-time">{humanTime(story.createdAt())}</span>
            </span>
          </span>
        ) : null}
      </button>
      {status(story) ? <p className="GlimpseCard-status">{status(story)}</p> : null}
      {footer ? <div className="GlimpseCard-foot">{footer}</div> : null}
    </article>
  );
}

/** What a story's author (or a moderator) needs to know that a viewer never sees. */
function status(story: Story): Mithril.Children {
  if (story.status() === 'pending') return t('profile.pending');
  if (story.status() === 'hidden') return t('profile.hidden');
  const expires = story.expiresAt();
  return expires && expires.getTime() < Date.now() ? t('profile.kept') : null;
}

/** Plays the given stories grouped by author, starting at one of them. */
function play(stories: Story[], start: Story): void {
  const users: User[] = [];
  stories.forEach((story) => {
    const user = story.user();
    if (user && !users.includes(user)) users.push(user);
  });
  const author = start.user();
  if (author) openViewer({ users, start: author, startStory: start });
}

/** `/stories` (and `/stories/:id`, which opens that story over it): every live story you can see. */
export class StoriesPage extends Page {
  private stories: Story[] = [];
  private loading = true;
  private more = false;
  private following = false;
  private unlisten: (() => void) | null = null;

  oninit(vnode: Mithril.Vnode) {
    super.oninit(vnode);
    app.setTitle(tx('page.title'));
    this.bodyClass = 'GlimpsePage-body';
    this.load(0);
    this.unlisten = onStoriesChanged(() => this.load(0));

    const id = m.route.param('id');
    if (id) {
      app.store
        .find<Story>('stories', id)
        .then((story) => {
          const user = (story as Story).user();
          if (user)
            openViewer({
              users: [user],
              start: user,
              startStory: story as Story,
              onclose: () => m.route.set(app.route('glimpse.stories'), null, { replace: true }),
            });
        })
        .catch(() => app.alerts.show({ type: 'error' }, tx('page.gone')));
    }
  }

  onremove(vnode: Mithril.VnodeDOM) {
    super.onremove(vnode);
    this.unlisten?.();
  }

  load(offset: number): void {
    this.loading = true;
    const filter: Record<string, string> = this.following ? { live: '1', following: '1' } : { live: '1' };
    app.store
      .find<Story[]>('stories', { filter, page: { offset, limit: PAGE, total: 0 } } as any)
      .then((stories: any) => {
        this.stories = offset ? [...this.stories, ...stories] : [...stories];
        this.more = !!stories.payload?.links?.next;
      })
      .catch(failed)
      .finally(() => {
        this.loading = false;
        m.redraw();
      });
  }

  view() {
    return (
      <PageStructure className="GlimpsePage" sidebar={() => <IndexSidebar />}>
        <header className="GlimpsePage-head">
          <div>
            <h1 className="GlimpsePage-title">{t('page.title')}</h1>
            <p className="GlimpsePage-intro">{t('page.intro', { count: app.forum.attribute('glimpseLifetimeHours') || 24 })}</p>
          </div>
          {app.forum.attribute('glimpseCanCreate') ? (
            <Button className="Button Button--primary" icon="fas fa-plus" onclick={() => openCreate()}>
              {t('page.add')}
            </Button>
          ) : null}
        </header>
        {app.forum.attribute('glimpseFollows') && app.session.user ? (
          <div className="GlimpsePage-chips" role="tablist">
            {[false, true].map((following) => (
              <button
                type="button"
                role="tab"
                aria-selected={this.following === following ? 'true' : 'false'}
                className={classList('GlimpseChip', this.following === following && 'is-active')}
                onclick={() => {
                  this.following = following;
                  this.load(0);
                }}
              >
                {t(following ? 'page.following' : 'page.all')}
              </button>
            ))}
          </div>
        ) : null}
        {this.stories.length ? (
          <div className="GlimpseGrid">{this.stories.map((story) => storyCard(story, () => play(this.stories, story)))}</div>
        ) : this.loading ? null : (
          <p className="GlimpsePage-empty">{t('page.empty')}</p>
        )}
        {this.loading ? <LoadingIndicator /> : null}
        {this.more && !this.loading ? (
          <div className="GlimpsePage-more">
            <Button className="Button" onclick={() => this.load(this.stories.length)}>
              {t('page.load_more')}
            </Button>
          </div>
        ) : null}
      </PageStructure>
    );
  }
}

/** `/stories/queue`: stories waiting for approval, and reported ones. Moderators only (the server checks). */
export class QueuePage extends Page {
  private tab: 'pending' | 'reported' = 'pending';
  private stories: Story[] = [];
  private reports: StoryReport[] = [];
  private loading = true;

  oninit(vnode: Mithril.Vnode) {
    super.oninit(vnode);
    app.setTitle(tx('queue.title'));
    this.load();
  }

  load(): void {
    this.loading = true;
    const request =
      this.tab === 'pending'
        ? app.store
            .find<Story[]>('stories', { filter: { status: 'pending' }, page: { limit: 50, total: 0 } } as any)
            .then((s) => (this.stories = [...(s as Story[])]))
        : app.store
            .find<StoryReport[]>('story-reports', { include: 'story,story.user,user', page: { limit: 50, total: 0 } } as any)
            .then((r) => (this.reports = [...(r as StoryReport[])]));
    request.catch(failed).finally(() => {
      this.loading = false;
      m.redraw();
    });
  }

  view() {
    return (
      <PageStructure className="GlimpsePage GlimpseQueue" sidebar={() => <IndexSidebar />}>
        <header className="GlimpsePage-head">
          <h1 className="GlimpsePage-title">{t('queue.title')}</h1>
        </header>
        <div className="GlimpsePage-chips" role="tablist">
          {(['pending', 'reported'] as const).map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={this.tab === tab ? 'true' : 'false'}
              className={classList('GlimpseChip', this.tab === tab && 'is-active')}
              onclick={() => {
                this.tab = tab;
                this.load();
              }}
            >
              {t(`queue.${tab}`)}
            </button>
          ))}
        </div>
        {this.loading ? <LoadingIndicator /> : this.tab === 'pending' ? this.pending() : this.reported()}
      </PageStructure>
    );
  }

  private pending(): Mithril.Children {
    if (!this.stories.length) return <p className="GlimpsePage-empty">{t('queue.pending_empty')}</p>;

    return (
      <div className="GlimpseGrid">
        {this.stories.map((story) =>
          storyCard(story, () => play(this.stories, story), [
            <Button className="Button Button--primary" icon="fas fa-check" onclick={() => this.decide(story, 'live')}>
              {t('queue.approve')}
            </Button>,
            <Button className="Button" icon="fas fa-eye-slash" onclick={() => this.decide(story, 'hidden')}>
              {t('queue.decline')}
            </Button>,
          ])
        )}
      </div>
    );
  }

  private reported(): Mithril.Children {
    if (!this.reports.length) return <p className="GlimpsePage-empty">{t('queue.reported_empty')}</p>;

    return (
      <ul className="GlimpseReports">
        {this.reports.map((report) => {
          const story = report.story() || null;
          const reporter = report.user();
          return (
            <li className="GlimpseReports-item">
              {story && story.user()
                ? storyCard(story, () => openViewer({ users: [story.user() as User], start: story.user() as User, stories: [story] }))
                : null}
              <div className="GlimpseReports-body">
                <p className="GlimpseReports-reason">
                  <strong>{t(`report.reasons.${report.reason()}`)}</strong>
                  {' · '}
                  {reporter ? reporter.displayName() : null} {humanTime(report.createdAt())}
                </p>
                {report.detail() ? <p className="GlimpseReports-detail">{report.detail()}</p> : null}
                <div className="GlimpseReports-actions">
                  <Button className="Button" icon="fas fa-check" onclick={() => this.dismiss(report)}>
                    {t('queue.dismiss')}
                  </Button>
                  {story ? (
                    <Button className="Button" icon="fas fa-eye-slash" onclick={() => this.decide(story, 'hidden').then(() => this.dismiss(report))}>
                      {t('queue.hide')}
                    </Button>
                  ) : null}
                  {story?.canDelete() ? (
                    <Button
                      className="Button Button--danger"
                      icon="fas fa-trash"
                      onclick={() => {
                        if (confirm(tx('viewer.delete_confirm'))) story.delete().then(() => this.load());
                      }}
                    >
                      {t('queue.delete')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  private decide(story: Story, status: 'live' | 'hidden'): Promise<void> {
    return story.save({ status }).then(() => {
      this.stories = this.stories.filter((s) => s !== story);
      const pending = Number(app.forum.attribute('glimpsePending') || 0);
      app.forum.pushAttributes({ glimpsePending: Math.max(0, pending - 1) });
      storiesChanged();
      m.redraw();
    });
  }

  private dismiss(report: StoryReport): void {
    report.delete().then(() => {
      this.reports = this.reports.filter((r) => r !== report);
      m.redraw();
    });
  }
}

let made: any = null;

/**
 * The profile tab: the member's highlights row and their live stories. UserPage lives in a lazy chunk,
 * so the class is made once it is loaded.
 */
export async function userStoriesPage(): Promise<any> {
  if (made) return made;
  const mod = await flarum.reg.asyncModuleImport('flarum/forum/components/UserPage');
  const UserPage = mod.default || mod;

  made = class UserStoriesPage extends UserPage {
    stories: Story[] = [];
    highlights: StoryHighlight[] = [];
    loading = true;
    unlisten: (() => void) | null = null;

    oninit(vnode: Mithril.Vnode) {
      super.oninit(vnode);
      this.loadUser(m.route.param('username'));
      this.unlisten = onStoriesChanged(() => this.load());
    }

    onremove(vnode: Mithril.VnodeDOM) {
      super.onremove(vnode);
      this.unlisten?.();
    }

    show(user: User) {
      super.show(user);
      this.load();
    }

    own(): boolean {
      return !!app.session.user && this.user === app.session.user;
    }

    load() {
      if (!this.user) return;
      this.loading = true;
      Promise.all([
        app.store.find<StoryHighlight[]>('story-highlights', { filter: { user: this.user.id() } } as any),
        app.store.find<Story[]>('stories', {
          filter: { author: this.user.id(), live: '1' },
          sort: 'createdAt',
          page: { limit: 100, total: 0 },
        } as any),
      ])
        .then(([highlights, stories]) => {
          this.highlights = [...(highlights as StoryHighlight[])];
          this.stories = [...(stories as Story[])];
        })
        .catch(failed)
        .finally(() => {
          this.loading = false;
          m.redraw();
        });
    }

    content() {
      const highlights = this.highlights.filter((h) => (h.stories() || []).filter(Boolean).length);

      return (
        <div className="GlimpseProfile">
          {highlights.length || this.own() ? (
            <section className="GlimpseProfile-section">
              <h2 className="GlimpseProfile-label">{t('highlights.title')}</h2>
              <ul className="GlimpseHighlights">
                {highlights.map((highlight) => {
                  const stories = (highlight.stories() || []).filter(Boolean) as Story[];
                  const cover = stories[0];
                  return (
                    <li>
                      <button
                        type="button"
                        className="GlimpseHighlights-item"
                        aria-label={tx('highlights.play', { title: highlight.title() })}
                        onclick={() => openViewer({ users: [this.user], start: this.user, stories, label: highlight.title() })}
                      >
                        <span
                          className={classList(
                            'GlimpseHighlights-cover',
                            cover?.kind() === 'text' && `GlimpseText GlimpseBg-${cover.background() ?? 0}`
                          )}
                        >
                          {cover && cover.kind() === 'photo' ? <img src={cover.mediaUrl()!} alt="" loading="lazy" /> : null}
                          {cover && cover.kind() === 'video' ? (
                            <video src={`${cover.mediaUrl()}#t=0.1`} preload="metadata" muted playsinline aria-hidden="true" />
                          ) : null}
                        </span>
                        <span className="GlimpseHighlights-title">{highlight.title()}</span>
                      </button>
                      {this.own() ? (
                        <button
                          type="button"
                          className="GlimpseHighlights-remove"
                          aria-label={tx('highlights.delete', { title: highlight.title() })}
                          onclick={() => {
                            if (confirm(tx('highlights.delete_confirm', { title: highlight.title() }))) highlight.delete().then(() => this.load());
                          }}
                        >
                          <i className="fas fa-xmark" aria-hidden="true" />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {this.own() && !highlights.length ? <p className="GlimpseProfile-hint">{t('highlights.hint')}</p> : null}
            </section>
          ) : null}

          <section className="GlimpseProfile-section">
            <div className="GlimpseProfile-row">
              <h2 className="GlimpseProfile-label">{t('profile.live')}</h2>
              {this.own() && app.forum.attribute('glimpseCanCreate') ? (
                <Button className="Button Button--primary" icon="fas fa-plus" onclick={() => openCreate()}>
                  {t('page.add')}
                </Button>
              ) : null}
            </div>
            {this.loading ? (
              <LoadingIndicator />
            ) : this.stories.length ? (
              <div className="GlimpseGrid">
                {this.stories.map((story) =>
                  storyCard(story, () => openViewer({ users: [this.user], start: this.user, stories: this.stories, startStory: story }))
                )}
              </div>
            ) : (
              <p className="GlimpsePage-empty">{t(this.own() ? 'profile.empty_own' : 'profile.empty', { name: this.user.displayName() })}</p>
            )}
          </section>
        </div>
      );
    }
  };

  return made;
}
