import app from 'flarum/forum/app';
import Component, { type ComponentAttrs } from 'flarum/common/Component';
import Avatar from 'flarum/common/components/Avatar';
import Link from 'flarum/common/components/Link';
import classList from 'flarum/common/utils/classList';
import humanTime from 'flarum/common/helpers/humanTime';
import type User from 'flarum/common/models/User';
import type Mithril from 'mithril';
import type Story from '../models/Story';
import { storiesChanged, t, tx } from '../util';
import caption from './caption';
import { replyChannel, sendReply } from './reply';
import { openHighlightPicker, openReport, openSeenBy } from './modals';

export interface ViewerOptions {
  /** The people to play, in order. */
  users: User[];
  /** Whose stories to start with. */
  start: User;
  /** Stories already in hand for the start person (your own ring, a highlight): nothing is fetched for them. */
  stories?: Story[];
  /** Which of those to begin at. */
  startStory?: Story;
  /** A highlight's title, shown under the name. */
  label?: string;
  onclose?: () => void;
}

interface ViewerAttrs extends ComponentAttrs {
  options: ViewerOptions;
  close: () => void;
}

const SEEN_FLUSH_MS = 1500;
const HOLD_MS = 200;
const SWIPE_PX = 70;
const CLOSE_PX = 90;

/**
 * The full-screen story player.
 *
 * Tap the right two thirds to go on, the left third to go back; hold to pause; swipe down (or Esc) to
 * close; swipe sideways to change person. Keys: ← → Space Esc. Photos and text stay up for the admin's
 * time, a video for its length (never past the admin's limit). The next story's media is fetched while
 * this one plays, and the next person's stories while their last one plays. Stories are marked seen in
 * batches, not one request each.
 */
export default class Viewer extends Component<ViewerAttrs> {
  private users: User[] = [];
  private userIndex = 0;
  private stories: Story[] = [];
  private index = 0;
  private loading = false;
  private cache = new Map<string, Promise<Story[]>>();

  private elapsed = 0;
  private duration = 6000;
  private last = 0;
  private raf = 0;
  private paused = false;
  private holding = false;
  private muted = true;
  private menuOpen = false;
  private reacting = false;
  private toast: string | null = null;
  private toastTimer = 0;
  private replyText = '';

  private seen = new Set<string>();
  private seenTimer = 0;
  private pointer: { x: number; y: number; moved: boolean; timer: number } | null = null;
  private drag = 0;
  private previousFocus: Element | null = null;
  private keyHandler = (e: KeyboardEvent) => this.onkey(e);

  oninit(vnode: Mithril.Vnode<ViewerAttrs, this>) {
    super.oninit(vnode);
    const { users, start, stories, startStory } = this.attrs.options;
    this.users = users;
    this.userIndex = Math.max(0, users.indexOf(start));
    if (stories) this.cache.set(start.id()!, Promise.resolve(stories));
    this.loadUser(startStory);
  }

  oncreate(vnode: Mithril.VnodeDOM<ViewerAttrs, this>) {
    super.oncreate(vnode);
    this.previousFocus = document.activeElement;
    document.addEventListener('keydown', this.keyHandler);
    document.body.classList.add('GlimpseViewer-open');
    (vnode.dom.querySelector('.GlimpseViewer-close') as HTMLElement | null)?.focus();
    this.last = performance.now();
    this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  onremove(vnode: Mithril.VnodeDOM<ViewerAttrs, this>) {
    super.onremove(vnode);
    cancelAnimationFrame(this.raf);
    clearTimeout(this.toastTimer);
    document.removeEventListener('keydown', this.keyHandler);
    document.body.classList.remove('GlimpseViewer-open');
    this.flushSeen();
    (this.previousFocus as HTMLElement | null)?.focus?.();
  }

  // ---------- data ----------

  private user(): User | undefined {
    return this.users[this.userIndex];
  }

  private story(): Story | undefined {
    return this.stories[this.index];
  }

  private fetch(user: User): Promise<Story[]> {
    const id = user.id()!;
    if (!this.cache.has(id)) {
      this.cache.set(
        id,
        app.store
          .find<Story[]>('stories', { filter: { author: id, live: '1' }, sort: 'createdAt', page: { limit: 100, total: 0 } } as any)
          .then((stories) => [...(stories as Story[])])
          .catch(() => [])
      );
    }
    return this.cache.get(id)!;
  }

  private loadUser(startStory?: Story, fromEnd = false): void {
    const user = this.user();
    if (!user) return this.attrs.close();

    this.loading = true;
    this.fetch(user).then((stories) => {
      if (this.user() !== user) return;
      this.loading = false;
      if (!stories.length) {
        // Gone (expired, deleted) since the bar was drawn: on to the next person.
        this.users.splice(this.userIndex, 1);
        if (!this.users.length) return this.attrs.close();
        this.userIndex = Math.min(this.userIndex, this.users.length - 1);
        return this.loadUser();
      }
      this.stories = stories;
      const firstUnseen = stories.findIndex((story) => !story.isSeen());
      this.index = startStory ? Math.max(0, stories.indexOf(startStory)) : fromEnd ? stories.length - 1 : Math.max(0, firstUnseen);
      this.begin();
      m.redraw();
    });
  }

  private begin(): void {
    const story = this.story();
    if (!story) return;
    this.elapsed = 0;
    this.last = performance.now();
    this.menuOpen = false;
    this.reacting = false;
    this.paused = false;
    const slide = (Number(app.forum.attribute('glimpseSlideSeconds')) || 6) * 1000;
    const max = (Number(app.forum.attribute('glimpseVideoMaxSeconds')) || 15) * 1000;
    this.duration = story.kind() === 'video' ? Math.min(story.durationMs() || max, max) : slide;
    this.markSeen(story);
    this.prefetch();
  }

  private prefetch(): void {
    const next = this.stories[this.index + 1];
    if (next) return preload(next);
    const nextUser = this.users[this.userIndex + 1];
    if (nextUser) this.fetch(nextUser).then((stories) => stories[0] && preload(stories[0]));
  }

  private markSeen(story: Story): void {
    if (story.isSeen() || story.user() === app.session.user || !app.session.user) return;
    story.pushAttributes({ isSeen: true });
    this.seen.add(story.id()!);
    clearTimeout(this.seenTimer);
    this.seenTimer = window.setTimeout(() => this.flushSeen(), SEEN_FLUSH_MS);
  }

  private flushSeen(): void {
    clearTimeout(this.seenTimer);
    if (!this.seen.size) return;
    const ids = [...this.seen].map(Number);
    this.seen.clear();
    app.request({ method: 'POST', url: `${app.forum.attribute('apiUrl')}/stories/seen`, body: { ids } }).catch(() => {});
  }

  // ---------- playback ----------

  private tick(now: number): void {
    const video = this.video();
    if (!this.paused && !this.loading && this.story()) {
      if (video && video.duration && isFinite(video.duration)) {
        this.duration = Math.min(video.duration * 1000, (Number(app.forum.attribute('glimpseVideoMaxSeconds')) || 15) * 1000);
        this.elapsed = video.currentTime * 1000;
      } else if (!video) {
        this.elapsed += now - this.last;
      }
      const bar = this.element?.querySelector<HTMLElement>('.GlimpseViewer-progress li.is-current b');
      if (bar) bar.style.width = `${Math.min(100, (this.elapsed / this.duration) * 100)}%`;
      if (this.elapsed >= this.duration) this.next();
    }
    this.last = now;
    this.raf = requestAnimationFrame((time) => this.tick(time));
  }

  private video(): HTMLVideoElement | null {
    return this.element?.querySelector<HTMLVideoElement>('.GlimpseViewer-media video') ?? null;
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.last = performance.now();
    const video = this.video();
    if (video) paused ? video.pause() : video.play().catch(() => {});
    m.redraw();
  }

  next(): void {
    if (this.index < this.stories.length - 1) {
      this.index++;
      this.begin();
      m.redraw();
    } else this.nextUser();
  }

  previous(): void {
    if (this.index > 0) {
      this.index--;
      this.begin();
      m.redraw();
    } else if (this.userIndex > 0) {
      this.userIndex--;
      this.loadUser(undefined, true);
    } else {
      this.begin();
    }
  }

  nextUser(): void {
    this.flushSeen();
    if (this.userIndex < this.users.length - 1) {
      this.userIndex++;
      this.loadUser();
    } else this.attrs.close();
  }

  previousUser(): void {
    if (this.userIndex > 0) {
      this.userIndex--;
      this.loadUser();
    } else {
      this.index = 0;
      this.begin();
    }
  }

  // ---------- input ----------

  private onkey(e: KeyboardEvent): void {
    // Typing a reply, or a modal on top: the keys are theirs.
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, .ModalManager')) return;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.previous();
    } else if (e.key === ' ') {
      e.preventDefault();
      this.setPaused(!this.paused);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (this.menuOpen) {
        this.menuOpen = false;
        this.setPaused(false);
      } else this.attrs.close();
    }
  }

  private pointerdown(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest('button, a, input, .GlimpseViewer-menu, .GlimpseViewer-reactions')) return;
    this.holding = false;
    this.pointer = {
      x: e.clientX,
      y: e.clientY,
      moved: false,
      timer: window.setTimeout(() => {
        this.holding = true;
        this.setPaused(true);
      }, HOLD_MS),
    };
  }

  private pointermove(e: PointerEvent): void {
    if (!this.pointer) return;
    const dx = e.clientX - this.pointer.x;
    const dy = e.clientY - this.pointer.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      this.pointer.moved = true;
      clearTimeout(this.pointer.timer);
    }
    this.drag = Math.max(0, dy);
    const card = this.element?.querySelector<HTMLElement>('.GlimpseViewer-card');
    if (card) card.style.transform = this.drag ? `translateY(${this.drag}px) scale(${1 - this.drag / 1500})` : '';
  }

  private pointerup(e: PointerEvent): void {
    const start = this.pointer;
    this.pointer = null;
    this.drag = 0;
    const card = this.element?.querySelector<HTMLElement>('.GlimpseViewer-card');
    if (card) card.style.transform = '';
    if (!start) return;
    clearTimeout(start.timer);

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const wasHold = this.holding;
    if (wasHold) {
      this.holding = false;
      this.setPaused(false);
    }

    if (dy > CLOSE_PX && Math.abs(dy) > Math.abs(dx)) return this.attrs.close();
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? this.nextUser() : this.previousUser();
    if (wasHold || start.moved || !card) return;

    const rect = card.getBoundingClientRect();
    e.clientX - rect.left > rect.width / 3 ? this.next() : this.previous();
  }

  private pointercancel(): void {
    if (this.pointer) clearTimeout(this.pointer.timer);
    this.pointer = null;
    if (this.holding) {
      this.holding = false;
      this.setPaused(false);
    }
  }

  private say(message: string): void {
    this.toast = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast = null;
      m.redraw();
    }, 1800);
    m.redraw();
  }

  // ---------- actions ----------

  private react(reaction: string | null): void {
    const story = this.story();
    if (!story) return;
    this.reacting = false;
    const previous = story.myReaction();
    story.pushAttributes({ myReaction: reaction });
    app
      .request<any>({ method: 'POST', url: `${app.forum.attribute('apiUrl')}/stories/${story.id()}/reaction`, body: { reaction } })
      .then((payload) => {
        app.store.pushPayload(payload);
        this.say(reaction ? tx('viewer.reacted', { reaction }) : tx('viewer.unreacted'));
      })
      .catch(() => story.pushAttributes({ myReaction: previous }))
      .finally(() => this.setPaused(false));
  }

  private reply(): void {
    const story = this.story();
    const text = this.replyText.trim();
    if (!story || !text) return;
    this.replyText = '';
    (document.activeElement as HTMLElement | null)?.blur();
    sendReply(story, text)
      .then(() => this.say(tx('viewer.reply_sent', { name: (story.user() || null)?.displayName() })))
      .catch(() => this.say(tx('viewer.reply_failed')))
      .finally(() => this.setPaused(false));
  }

  private menu(action: string): void {
    const story = this.story();
    const user = this.user();
    this.menuOpen = false;
    if (!story || !user) return;

    const resume = () => this.setPaused(false);

    switch (action) {
      case 'report':
        openReport(story, () => this.say(tx('viewer.reported')), resume);
        break;
      case 'mute':
        app.store
          .createRecord('story-mutes')
          .save({ relationships: { mutedUser: user } } as any)
          .then(() => {
            this.say(tx('viewer.muted', { name: user.displayName() }));
            storiesChanged();
            window.setTimeout(() => this.nextUser(), 700);
          });
        break;
      case 'copy':
        navigator.clipboard
          ?.writeText(app.forum.attribute<string>('baseUrl') + app.route('glimpse.story', { id: story.id() }))
          .then(() => this.say(tx('viewer.copied')))
          .catch(() => {});
        resume();
        break;
      case 'highlight':
        openHighlightPicker(story, (title) => this.say(tx('viewer.highlighted', { title })), resume);
        break;
      case 'hide':
        story.save({ status: 'hidden' }).then(() => {
          this.say(tx('viewer.hidden'));
          storiesChanged();
          resume();
        });
        break;
      case 'delete':
        if (!confirm(tx('viewer.delete_confirm'))) return resume();
        story.delete().then(() => {
          this.say(tx('viewer.deleted'));
          storiesChanged();
          this.stories.splice(this.index, 1);
          this.cache.delete(user.id()!);
          if (!this.stories.length) return this.nextUser();
          this.index = Math.min(this.index, this.stories.length - 1);
          this.begin();
        });
        break;
    }
  }

  // ---------- view ----------

  view() {
    const story = this.story();
    const user = this.user();
    const own = !!story && story.user() === app.session.user;
    const reactions: string[] = app.forum.attribute('glimpseReactions') || ['❤️'];
    const channel = replyChannel();

    return (
      <div
        className={classList('GlimpseViewer', this.paused && 'is-paused', this.holding && 'is-holding')}
        role="dialog"
        aria-modal="true"
        aria-label={tx('viewer.label', { name: user?.displayName() || '' })}
      >
        <button type="button" className="GlimpseViewer-close" aria-label={tx('viewer.close')} onclick={() => this.attrs.close()}>
          <i className="fas fa-xmark" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="GlimpseViewer-arrow GlimpseViewer-arrow--prev"
          aria-label={tx('viewer.previous')}
          onclick={() => this.previous()}
        >
          <i className="fas fa-chevron-left" aria-hidden="true" />
        </button>

        <div
          className="GlimpseViewer-card"
          onpointerdown={(e: PointerEvent) => this.pointerdown(e)}
          onpointermove={(e: PointerEvent) => this.pointermove(e)}
          onpointerup={(e: PointerEvent) => this.pointerup(e)}
          onpointercancel={() => this.pointercancel()}
          oncontextmenu={(e: Event) => e.preventDefault()}
        >
          {story ? this.media(story) : <div className="GlimpseViewer-media GlimpseViewer-media--loading" />}

          <ol className="GlimpseViewer-progress" aria-hidden="true">
            {this.stories.map((s, i) => (
              <li className={classList(i < this.index && 'is-done', i === this.index && 'is-current')}>
                <b />
              </li>
            ))}
          </ol>

          {story && user ? (
            <header className="GlimpseViewer-head">
              <Link href={app.route.user(user)} className="GlimpseViewer-author" onclick={() => this.attrs.close()}>
                <Avatar user={user} />
                <span className="GlimpseViewer-name">{own ? t('viewer.your_story') : user.displayName()}</span>
              </Link>
              <span className="GlimpseViewer-time">{this.attrs.options.label || humanTime(story.createdAt())}</span>
              <i
                className={classList('GlimpseViewer-audience fas', AUDIENCE_ICONS[story.audience()])}
                title={tx(`audience.${story.audience()}`)}
                aria-label={tx(`audience.${story.audience()}`)}
              />
              <span className="GlimpseViewer-spacer" />
              {story.kind() === 'video' ? (
                <button
                  type="button"
                  className="GlimpseViewer-icon"
                  aria-label={tx(this.muted ? 'viewer.unmute' : 'viewer.mute')}
                  onclick={() => this.toggleSound()}
                >
                  <i className={classList('fas', this.muted ? 'fa-volume-xmark' : 'fa-volume-high')} aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                className="GlimpseViewer-icon"
                aria-label={tx(this.paused ? 'viewer.play' : 'viewer.pause')}
                onclick={() => this.setPaused(!this.paused)}
              >
                <i className={classList('fas', this.paused ? 'fa-play' : 'fa-pause')} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="GlimpseViewer-icon"
                aria-label={tx('viewer.more')}
                aria-expanded={this.menuOpen ? 'true' : 'false'}
                onclick={() => {
                  this.menuOpen = !this.menuOpen;
                  this.setPaused(this.menuOpen);
                }}
              >
                <i className="fas fa-ellipsis" aria-hidden="true" />
              </button>
            </header>
          ) : null}

          {this.menuOpen && story ? this.menuView(story, own) : null}

          {this.paused && this.holding ? <div className="GlimpseViewer-paused">{t('viewer.paused')}</div> : null}
          {this.toast ? (
            <div className="GlimpseViewer-toast" role="status">
              {this.toast}
            </div>
          ) : null}

          {story ? (
            <footer className="GlimpseViewer-foot">
              {story.caption() ? <p className="GlimpseViewer-caption">{caption(story)}</p> : null}
              {story.linkUrl() ? (
                <a className="GlimpseViewer-link" href={story.linkUrl()!} target="_blank" rel="nofollow ugc noopener noreferrer">
                  <i className="fas fa-link" aria-hidden="true" /> {hostOf(story.linkUrl()!)}
                </a>
              ) : null}
              {own ? (
                <button type="button" className="GlimpseViewer-seen" onclick={() => this.openSeenBy(story)}>
                  <i className="fas fa-eye" aria-hidden="true" /> {t('viewer.seen_by', { count: story.viewCount() || 0 })}
                  {story.reactionCount() ? (
                    <span className="GlimpseViewer-seenReactions">
                      {' · '}
                      {t('viewer.reactions', { count: story.reactionCount() })}
                    </span>
                  ) : null}
                </button>
              ) : null}
              {!own && (story.canReact() || channel) ? (
                <div className="GlimpseViewer-reply">
                  {channel ? (
                    <input
                      className="GlimpseViewer-input"
                      placeholder={tx('viewer.reply_placeholder', { name: user?.displayName() })}
                      aria-label={tx('viewer.reply_label')}
                      maxlength={500}
                      value={this.replyText}
                      onfocus={() => this.setPaused(true)}
                      onblur={() => {
                        if (!this.replyText) this.setPaused(false);
                      }}
                      oninput={(e: InputEvent) => (this.replyText = (e.target as HTMLInputElement).value)}
                      onkeydown={(e: KeyboardEvent) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          this.reply();
                        }
                      }}
                    />
                  ) : (
                    <span className="GlimpseViewer-spacer" />
                  )}
                  {story.canReact() ? (
                    <button
                      type="button"
                      className={classList('GlimpseViewer-react', story.myReaction() && 'is-active')}
                      aria-label={tx('viewer.react')}
                      aria-expanded={this.reacting ? 'true' : 'false'}
                      onclick={() => {
                        if (reactions.length === 1) return this.react(story.myReaction() ? null : reactions[0]);
                        this.reacting = !this.reacting;
                        this.setPaused(this.reacting);
                      }}
                    >
                      {story.myReaction() || reactions[0]}
                    </button>
                  ) : null}
                  {channel && this.replyText.trim() ? (
                    <button type="button" className="GlimpseViewer-send" aria-label={tx('viewer.send')} onclick={() => this.reply()}>
                      <i className="fas fa-paper-plane" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </footer>
          ) : null}

          {this.reacting && story ? (
            <div className="GlimpseViewer-reactions" role="group" aria-label={tx('viewer.react')}>
              {reactions.map((reaction) => (
                <button
                  type="button"
                  className={classList(story.myReaction() === reaction && 'is-active')}
                  aria-pressed={story.myReaction() === reaction ? 'true' : 'false'}
                  onclick={() => this.react(story.myReaction() === reaction ? null : reaction)}
                >
                  {reaction}
                </button>
              ))}
            </div>
          ) : null}

          {this.nextPreload()}
        </div>

        <button type="button" className="GlimpseViewer-arrow GlimpseViewer-arrow--next" aria-label={tx('viewer.next')} onclick={() => this.next()}>
          <i className="fas fa-chevron-right" aria-hidden="true" />
        </button>
      </div>
    );
  }

  private media(story: Story): Mithril.Children {
    if (story.kind() === 'text') {
      const text = story.text() || '';
      return (
        <div className={classList('GlimpseViewer-media GlimpseText', `GlimpseBg-${story.background() ?? 0}`)}>
          <p className={classList('GlimpseText-body', text.length > 90 && 'is-long')}>{text}</p>
        </div>
      );
    }

    return (
      <div className="GlimpseViewer-media">
        {story.kind() === 'video' ? (
          <video
            key={story.id()}
            src={story.mediaUrl()!}
            autoplay
            playsinline
            muted={this.muted}
            preload="auto"
            onended={() => this.next()}
            onloadeddata={(e: Event) => {
              if (this.paused) (e.target as HTMLVideoElement).pause();
            }}
          />
        ) : (
          <img
            key={story.id()}
            src={story.mediaUrl()!}
            alt={story.caption() || tx('viewer.photo_alt', { name: (story.user() || null)?.displayName() })}
            draggable={false}
          />
        )}
      </div>
    );
  }

  /** The next story's media, fetched while this one plays. */
  private nextPreload(): Mithril.Children {
    const next = this.stories[this.index + 1];
    if (!next || next.kind() !== 'video' || !next.mediaUrl()) return null;
    return <video className="GlimpseViewer-preload" src={next.mediaUrl()!} preload="auto" muted playsinline aria-hidden="true" />;
  }

  private menuView(story: Story, own: boolean): Mithril.Children {
    const items: Array<[string, string, string?]> = [];
    if (own) items.push(['highlight', 'fa-star']);
    if (story.canReport()) items.push(['report', 'fa-flag']);
    if (!own && app.session.user) items.push(['mute', 'fa-volume-xmark']);
    items.push(['copy', 'fa-link']);
    if (story.canModerate() && !own) items.push(['hide', 'fa-eye-slash', 'danger']);
    if (story.canDelete()) items.push(['delete', 'fa-trash', 'danger']);

    return (
      <ul className="GlimpseViewer-menu" role="menu">
        {items.map(([action, icon, tone]) => (
          <li role="none">
            <button type="button" role="menuitem" className={classList(tone && 'is-danger')} onclick={() => this.menu(action)}>
              <i className={classList('fas', icon)} aria-hidden="true" />{' '}
              {t(`viewer.menu.${action}`, { name: (story.user() || null)?.displayName() })}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  private toggleSound(): void {
    this.muted = !this.muted;
    const video = this.video();
    if (video) video.muted = this.muted;
  }

  private openSeenBy(story: Story): void {
    this.setPaused(true);
    openSeenBy(story, () => this.setPaused(false));
  }
}

const AUDIENCE_ICONS: Record<string, string> = {
  everyone: 'fa-globe',
  members: 'fa-user-check',
  followers: 'fa-user-group',
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return url;
  }
}

/** Starts fetching a photo before it is shown (videos are preloaded by an element in the view). */
function preload(story: Story): void {
  if (story.kind() === 'photo' && story.mediaUrl()) {
    const img = new Image();
    img.decoding = 'async';
    img.src = story.mediaUrl()!;
  }
}

let mounted: HTMLElement | null = null;

/** Opens the viewer over the page. One at a time. */
export function openViewer(options: ViewerOptions): void {
  closeViewer();
  mounted = document.createElement('div');
  mounted.className = 'GlimpseViewer-root';
  document.body.appendChild(mounted);
  const close = () => {
    closeViewer();
    options.onclose?.();
    m.redraw();
  };
  m.mount(mounted, { view: () => <Viewer options={options} close={close} /> });
}

export function closeViewer(): void {
  if (!mounted) return;
  m.mount(mounted, null);
  mounted.remove();
  mounted = null;
}
