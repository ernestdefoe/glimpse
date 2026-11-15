import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import Extend from 'flarum/common/extenders';
import LinkButton from 'flarum/common/components/LinkButton';
import Notification from 'flarum/forum/components/Notification';
import type ItemList from 'flarum/common/utils/ItemList';
import type Mithril from 'mithril';
import Story from './models/Story';
import StoryHighlight from './models/StoryHighlight';
import StoryMedia from './models/StoryMedia';
import StoryMute from './models/StoryMute';
import StoryReport from './models/StoryReport';
import StoryView from './models/StoryView';
import RingBar from './RingBar';
import { registerWidgets } from './widgets';
import { t, ui } from './util';

export { default as RingBar } from './RingBar';
export { default as Story } from './models/Story';

/*
 * forum.js carries the models, the ring bar and the wiring. The viewer, the create sheet, the pages and
 * the modals are one lazy chunk (./ui), fetched the first time someone opens a story.
 */

const NOTIFICATIONS: Record<string, string> = {
  glimpseMentioned: 'fas fa-at',
  glimpseNewStory: 'fas fa-circle-play',
};

function notificationComponent(type: string) {
  return class extends Notification {
    icon() {
      return NOTIFICATIONS[type];
    }
    href() {
      const story = this.attrs.notification.subject() as Story | null;
      return story ? app.route('glimpse.story', { id: story.id() }) : app.route('glimpse.stories');
    }
    content() {
      return t(`notifications.${type}`, { user: this.attrs.notification.fromUser() });
    }
    excerpt() {
      const story = this.attrs.notification.subject() as Story | null;
      return story?.caption?.() || story?.text?.() || null;
    }
  };
}

const page = (name: 'StoriesPage' | 'QueuePage') => () => ui().then(async (chunk) => (await chunk.loadCore(), { default: chunk[name] }));

export const extenders = [
  new Extend.Store()
    .add('stories', Story)
    .add('story-highlights', StoryHighlight)
    .add('story-views', StoryView)
    .add('story-media', StoryMedia)
    .add('story-reports', StoryReport)
    .add('story-mutes', StoryMute),
  new Extend.Routes()
    .add('glimpse.stories', '/stories', page('StoriesPage'))
    .add('glimpse.queue', '/stories/queue', page('QueuePage'))
    .add('glimpse.story', '/stories/:id', page('StoriesPage'))
    .add('user.glimpse', '/u/:username/stories', () => ui().then(async (chunk) => ({ default: await chunk.userStoriesPage() }))),
  Object.keys(NOTIFICATIONS).reduce((ext, type) => ext.add(type, notificationComponent(type)), new Extend.Notification()),
];

export { extenders as extend };

/** Whether the ring bar belongs on this discussion list, by the admin's placement setting. */
function barHere(): boolean {
  if (!app.forum.attribute('glimpseCanView')) return false;
  const placement = app.forum.attribute<string>('glimpseBarPlacement');
  if (placement === 'index_tags') return true;
  return placement === 'index' && !m.route.param('tags');
}

app.initializers.add('ernestdefoe-glimpse', () => {
  registerWidgets();

  extend('flarum/forum/components/IndexPage', 'contentItems', function (items: ItemList<Mithril.Children>) {
    if (barHere()) items.add('glimpseBar', <RingBar />, 110);
  });

  extend('flarum/forum/components/IndexSidebar', 'navItems', function (items: ItemList<Mithril.Children>) {
    if (!app.forum.attribute('glimpseCanView')) return;
    items.add(
      'glimpse',
      <LinkButton href={app.route('glimpse.stories')} icon="fas fa-circle-play">
        {t('nav.stories')}
      </LinkButton>,
      74
    );

    if (app.forum.attribute('glimpseCanModerate')) {
      const pending = Number(app.forum.attribute('glimpsePending') || 0);
      items.add(
        'glimpseQueue',
        // The count is drawn by CSS from an attribute: SelectDropdown repeats the active item's label,
        // and one vnode in two places throws when it changes.
        <LinkButton
          href={app.route('glimpse.queue')}
          icon="fas fa-inbox"
          className="GlimpseNav-queue"
          data-count={pending ? (pending > 99 ? '99+' : String(pending)) : undefined}
        >
          {t('nav.queue')}
        </LinkButton>,
        73
      );
    }
  });

  extend('flarum/forum/components/UserPage', 'navItems', function (this: any, items: ItemList<Mithril.Children>) {
    if (!this.user || !app.forum.attribute('glimpseCanView')) return;
    items.add(
      'glimpse',
      <LinkButton href={app.route('user.glimpse', { username: this.user.slug() })} icon="fas fa-circle-play">
        {t('nav.stories')}
      </LinkButton>,
      85
    );
  });

  extend('flarum/forum/components/NotificationGrid', 'notificationTypes', function (items: ItemList<any>) {
    Object.entries(NOTIFICATIONS).forEach(([name, icon]) => items.add(name, { name, icon, label: t(`notifications.${name}_preference`) }));
  });
});
