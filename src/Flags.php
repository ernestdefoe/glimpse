<?php

declare(strict_types=1);

namespace ErnestDefoe\Glimpse;

use Flarum\User\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * What a story means to the person looking at it (have I seen it, my reaction, do I follow its author),
 * added to the story query as subselects. However many stories a page shows, these cost no extra query.
 */
class Flags
{
    public function __construct(private readonly Extensions $extensions)
    {
    }

    /**
     * @param Builder<Story> $query
     * @return Builder<Story>
     */
    public function apply(Builder $query, User $actor): Builder
    {
        if ($actor->isGuest()) {
            return $query;
        }

        $mine = fn (string $column) => fn (QueryBuilder $view) => $view->select($column)
            ->from('glimpse_views')
            ->whereColumn('glimpse_views.story_id', 'glimpse_stories.id')
            ->where('glimpse_views.user_id', $actor->id)
            ->limit(1);

        $query->addSelect([
            'glimpse_viewed_at' => $mine('viewed_at'),
            'glimpse_reaction' => $mine('reaction'),
        ]);

        if ($this->extensions->follows()) {
            $query->addSelect(['glimpse_followed' => fn (QueryBuilder $follow) => $follow->selectRaw('1')
                ->from('user_followers')
                ->whereColumn('user_followers.followed_user_id', 'glimpse_stories.user_id')
                ->where('user_followers.user_id', $actor->id)
                ->limit(1)]);
        }

        return $query;
    }

    public static function seen(Story $story): bool
    {
        return $story->getAttribute('glimpse_viewed_at') !== null;
    }

    public static function reaction(Story $story): ?string
    {
        $reaction = $story->getAttribute('glimpse_reaction');

        return is_string($reaction) ? $reaction : null;
    }

    public static function followed(Story $story): bool
    {
        return $story->getAttribute('glimpse_followed') !== null;
    }
}
