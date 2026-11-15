<?php

declare(strict_types=1);

namespace ErnestDefoe\Glimpse\Listener;

use ErnestDefoe\Glimpse\Media\Storage;
use ErnestDefoe\Glimpse\StoryMedia;
use Flarum\User\Event\Deleted;
use Flarum\User\Event\Deleting;

/**
 * When a member is deleted their stories and uploads go with them through the foreign keys; their
 * files are collected just before, and deleted only once the account really is gone.
 */
class DeleteMemberFiles
{
    /** @var array<int, list<string>> */
    private array $pending = [];

    public function __construct(private readonly Storage $storage)
    {
    }

    public function deleting(Deleting $event): void
    {
        $this->pending[$event->user->id] = array_values(array_filter(
            StoryMedia::query()->where('user_id', $event->user->id)->pluck('path')->all(),
            is_string(...)
        ));
    }

    public function deleted(Deleted $event): void
    {
        $paths = $this->pending[$event->user->id] ?? [];
        unset($this->pending[$event->user->id]);
        $this->storage->delete($paths);
    }
}
