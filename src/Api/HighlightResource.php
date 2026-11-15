<?php

declare(strict_types=1);

namespace ErnestDefoe\Glimpse\Api;

use Carbon\Carbon;
use ErnestDefoe\Glimpse\Config;
use ErnestDefoe\Glimpse\Highlight;
use ErnestDefoe\Glimpse\Ids;
use ErnestDefoe\Glimpse\Story;
use Flarum\Api\Context;
use Flarum\Api\Endpoint;
use Flarum\Api\Resource\AbstractDatabaseResource;
use Flarum\Api\Schema;
use Flarum\Foundation\ValidationException;
use Flarum\Locale\TranslatorInterface;
use Flarum\User\Exception\PermissionDeniedException;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\Relation;
use Tobyz\JsonApiServer\Context as BaseContext;
use Tobyz\JsonApiServer\Pagination\Pagination;

/**
 * The `story-highlights` type: a member's named, lasting collections of their own stories.
 *
 * GET    /api/story-highlights?filter[user]=<id>   a profile's row, in order, with the stories each
 *                                                  holds that the viewer may see
 * POST   /api/story-highlights                     {title, relationships.stories}
 * PATCH  /api/story-highlights/{id}                rename, reorder, or replace its stories
 * DELETE /api/story-highlights/{id}                the stories stay (and expire as usual)
 *
 * @extends AbstractDatabaseResource<Highlight>
 */
class HighlightResource extends AbstractDatabaseResource
{
    public function __construct(
        private readonly Config $config,
        private readonly TranslatorInterface $translator,
        private readonly ConnectionInterface $db,
    ) {
    }

    public function type(): string
    {
        return 'story-highlights';
    }

    public function model(): string
    {
        return Highlight::class;
    }

    /** @param Builder<Highlight> $query */
    public function scope(Builder $query, BaseContext $context): void
    {
        if (! $context->getActor()->hasPermission('glimpse.view')) {
            $query->whereRaw('1 = 0');
        }
    }

    public function endpoints(): array
    {
        $owner = fn (Highlight $highlight, Context $context): bool => $highlight->user_id === $context->getActor()->id;

        return [
            Endpoint\Index::make()
                ->defaultInclude(['stories'])
                ->query(fn (Builder $query, ?Pagination $pagination, Context $context, array $filters): Context => $context->withQuery(
                    $query->where('glimpse_highlights.user_id', Ids::one($filters['user'] ?? null))
                        ->orderBy('glimpse_highlights.position')
                        ->orderBy('glimpse_highlights.id')
                        ->limit($this->config->highlightsMax())
                )),
            Endpoint\Show::make()->defaultInclude(['stories']),
            Endpoint\Create::make()
                ->authenticated()
                ->can('glimpse.create')
                ->defaultInclude(['stories']),
            Endpoint\Update::make()
                ->authenticated()
                ->visible($owner)
                ->defaultInclude(['stories']),
            Endpoint\Delete::make()
                ->authenticated()
                ->visible($owner),
        ];
    }

    public function fields(): array
    {
        return [
            Schema\Str::make('title')
                ->requiredOnCreate()
                ->writable()
                ->minLength(1)
                ->maxLength(40),
            Schema\Integer::make('position')
                ->writableOnUpdate()
                ->rules(['integer', 'min:0', 'max:1000'], true),
            Schema\Relationship\ToOne::make('user')
                ->type('users')
                ->includable(),
            Schema\Relationship\ToMany::make('stories')
                ->type('stories')
                ->includable()
                ->writable()
                ->scope(fn (Builder|Relation $query, Context $context) => $query->whereVisibleTo($context->getActor()))
                ->set(fn (Highlight $highlight, array $stories, Context $context) => $this->setStories($highlight, $stories, $context)),
        ];
    }

    /** @param Context $context */
    public function creating(object $model, BaseContext $context): ?object
    {
        $actor = $context->getActor();
        if (Highlight::query()->where('user_id', $actor->id)->count() >= $this->config->highlightsMax()) {
            throw new ValidationException(['title' => $this->translator->trans('ernestdefoe-glimpse.api.highlights_full', ['{count}' => $this->config->highlightsMax()])]);
        }

        $model->user_id = $actor->id;
        $last = Highlight::query()->where('user_id', $actor->id)->max('position');
        $model->position = Ids::one($last) + 1;
        $model->created_at = Carbon::now();

        return $model;
    }

    /** @param Context $context */
    public function saved(object $model, BaseContext $context): ?object
    {
        if ($model->pendingStoryIds !== null) {
            $ids = $model->pendingStoryIds;
            $model->pendingStoryIds = null;
            $this->db->transaction(fn () => $model->stories()->sync(array_combine($ids, array_map(
                fn (int $position): array => ['position' => $position],
                array_keys($ids)
            ))));
        }

        return $model;
    }

    /**
     * Only the member's own stories, in the order given, up to the admin's limit.
     *
     * @param array<mixed> $stories
     */
    private function setStories(Highlight $highlight, array $stories, Context $context): void
    {
        $actor = $context->getActor();
        if ($highlight->exists && $highlight->user_id !== $actor->id) {
            throw new PermissionDeniedException();
        }

        $ids = array_values(array_unique(array_map(fn (mixed $story): int => $story instanceof Story ? $story->id : 0, $stories)));
        if (count($ids) > $this->config->highlightStoriesMax()) {
            throw new ValidationException(['stories' => $this->translator->trans('ernestdefoe-glimpse.api.highlight_full', ['{count}' => $this->config->highlightStoriesMax()])]);
        }

        $own = Ids::of(Story::query()->whereIn('id', $ids)->where('user_id', $actor->id)->pluck('id'));
        $highlight->pendingStoryIds = array_values(array_intersect($ids, $own));
    }
}
