<?php

declare(strict_types=1);

namespace ErnestDefoe\Glimpse\Access;

use ErnestDefoe\Glimpse\Config;
use ErnestDefoe\Glimpse\Story;
use Flarum\User\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * With fof/ignore-users (registered only while it's enabled) and the admin's switch on: an author who
 * ignores you hides their stories from you. Moderators are never hidden from.
 */
class HideFromIgnored
{
    public function __construct(private readonly Config $config)
    {
    }

    /** @param Builder<Story> $query */
    public function __invoke(User $actor, Builder $query): void
    {
        if ($actor->isGuest() || ! $this->config->ignoreHidesMine() || $actor->hasPermission('glimpse.moderate')) {
            return;
        }

        $query->whereNotIn('glimpse_stories.user_id', fn (QueryBuilder $ignoring) => $ignoring->select('user_id')
            ->from('ignored_user')
            ->where('ignored_user_id', $actor->id));
    }
}
