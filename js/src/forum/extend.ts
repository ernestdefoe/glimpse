import app from 'flarum/forum/app';
import Extend from 'flarum/common/extenders';
import Notification from 'flarum/forum/components/Notification';
import Story from './models/Story';
import StoryHighlight from './models/StoryHighlight';
import StoryMedia from './models/StoryMedia';
import StoryMute from './models/StoryMute';
import StoryReport from './models/StoryReport';
import StoryView from './models/StoryView';
import { t, ui } from './util';

/*
 * The declarative half of the forum: models, routes (the pages are a lazy chunk) and notification
 * components.
 */

export const NOTIFICATIONS: Record<string, string> = {
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

const extenders = [
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

export default extenders;
