<?php

declare(strict_types=1);

namespace ErnestDefoe\Glimpse\Search\Filter;

use ErnestDefoe\Glimpse\Story;
use Flarum\Search\Database\DatabaseSearchState;
use Flarum\Search\Filter\FilterInterface;
use Flarum\Search\SearchState;
use Illuminate\Database\Eloquent\Builder;

/**
 * `filter[bar]`: what the ring bar draws. The live stories of the 30 people who posted most recently
 * (minus the actor's mutes), found in the same query by joining a derived table of those authors.
 *
 * @implements FilterInterface<DatabaseSearchState>
 */
class BarFilter implements FilterInterface
{
    public const AUTHORS = 30;

    public function getFilterKey(): string
    {
        return 'bar';
    }

    public function filter(SearchState $state, string|array $value, bool $negate): void
    {
        $actor = $state->getActor();

        /** @var Builder<Story> $query */
        $query = $state->getQuery();
        LiveFilter::constrain($query, $actor);

        $authors = Story::whereVisibleTo($actor)
            ->select('glimpse_stories.user_id')
            // Unqualified on purpose: this subquery reads one table, so no prefix is needed.
            ->selectRaw('MAX(created_at) as glimpse_latest')
            ->groupBy('glimpse_stories.user_id')
            ->orderByDesc('glimpse_latest')
            ->limit(self::AUTHORS);
        LiveFilter::constrain($authors, $actor);

        $query->joinSub($authors->toBase(), 'glimpse_bar', 'glimpse_bar.user_id', '=', 'glimpse_stories.user_id');
    }
}
