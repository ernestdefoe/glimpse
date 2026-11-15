<?php

declare(strict_types=1);

namespace ErnestDefoe\Glimpse\Search\Filter;

use ErnestDefoe\Glimpse\Extensions;
use Flarum\Search\Database\DatabaseSearchState;
use Flarum\Search\Filter\FilterInterface;
use Flarum\Search\SearchState;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * `filter[following]`: stories by people the actor follows (ianm/follow-users). Without it, or for a
 * guest, nothing matches.
 *
 * @implements FilterInterface<DatabaseSearchState>
 */
class FollowingFilter implements FilterInterface
{
    public function __construct(private readonly Extensions $extensions)
    {
    }

    public function getFilterKey(): string
    {
        return 'following';
    }

    public function filter(SearchState $state, string|array $value, bool $negate): void
    {
        $actor = $state->getActor();

        if ($actor->isGuest() || ! $this->extensions->follows()) {
            $state->getQuery()->whereRaw('1 = 0');

            return;
        }

        $state->getQuery()->whereIn('glimpse_stories.user_id', fn (QueryBuilder $followed) => $followed->select('followed_user_id')
            ->from('user_followers')
            ->where('user_id', $actor->id), 'and', $negate);
    }
}
