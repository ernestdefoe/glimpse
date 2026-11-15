<?php

declare(strict_types=1);

namespace ErnestDefoe\Glimpse\Api;

use ErnestDefoe\Glimpse\Config;
use ErnestDefoe\Glimpse\Enum\Kind;
use ErnestDefoe\Glimpse\Enum\Status;
use ErnestDefoe\Glimpse\Extensions;
use ErnestDefoe\Glimpse\Story;
use Flarum\Api\Context;
use Flarum\Api\Schema;

/**
 * What the forum payload carries for Glimpse. Permissions come from groups already loaded for the
 * actor, so these cost no query, except the waiting count, asked only for moderators.
 */
class ForumFields
{
    public function __construct(private readonly Config $config, private readonly Extensions $extensions)
    {
    }

    /** @return list<Schema\Attribute> */
    public function __invoke(): array
    {
        return [
            Schema\Boolean::make('glimpseCanView')
                ->get(fn (object $forum, Context $context): bool => $context->getActor()->hasPermission('glimpse.view')),
            Schema\Boolean::make('glimpseCanCreate')
                ->get(fn (object $forum, Context $context): bool => $context->getActor()->can('glimpse.create')),
            Schema\Boolean::make('glimpseCanModerate')
                ->get(fn (object $forum, Context $context): bool => $context->getActor()->hasPermission('glimpse.moderate')),
            Schema\Integer::make('glimpsePending')
                ->visible(fn (object $forum, Context $context): bool => $context->getActor()->hasPermission('glimpse.moderate'))
                ->get(fn (): int => Story::query()->where('status', Status::Pending->value)->count()),
            Schema\Arr::make('glimpseReactions')
                ->get(fn (): array => $this->config->reactions()),
            Schema\Boolean::make('glimpseFollows')
                ->get(fn (): bool => $this->extensions->follows()),
            Schema\Integer::make('glimpseImageMaxBytes')
                ->get(fn (): int => $this->config->imageMaxBytes()),
            Schema\Integer::make('glimpseVideoMaxBytes')
                ->get(fn (): int => $this->config->videoMaxBytes()),
            Schema\Integer::make('glimpseVideoMaxSeconds')
                ->get(fn (): int => $this->config->videoMaxSeconds()),
            Schema\Integer::make('glimpseLifetimeHours')
                ->get(fn (): int => $this->config->lifetimeHours()),
            Schema\Integer::make('glimpseSlideSeconds')
                ->get(fn (): int => $this->config->slideSeconds()),
            Schema\Str::make('glimpseBarPlacement')
                ->get(fn (): string => $this->config->barPlacement()),
            Schema\Str::make('glimpseBarOrder')
                ->get(fn (): string => $this->config->barOrder()),
            Schema\Str::make('glimpseDefaultAudience')
                ->get(fn (): string => $this->config->defaultAudience()->value),
            Schema\Str::make('glimpseReplyVia')
                ->get(fn (): string => $this->config->replyVia()),
            Schema\Boolean::make('glimpseKindPhoto')
                ->get(fn (): bool => $this->config->allows(Kind::Photo)),
            Schema\Boolean::make('glimpseKindVideo')
                ->get(fn (): bool => $this->config->allows(Kind::Video)),
            Schema\Boolean::make('glimpseKindText')
                ->get(fn (): bool => $this->config->allows(Kind::Text)),
        ];
    }
}
