<?php

declare(strict_types=1);

namespace ErnestDefoe\Glimpse\Approval;

use Carbon\Carbon;
use ErnestDefoe\Glimpse\Config;
use Flarum\User\User;

/**
 * Whether a new story waits for a moderator: members with fewer posts or days than the admin set,
 * unless they may post stories without approval. TrustLevelApproval adds the trust level when
 * ernestdefoe/trust-levels is enabled.
 */
class Approval
{
    public function __construct(protected readonly Config $config)
    {
    }

    public function holds(User $actor): bool
    {
        if ($actor->hasPermission('glimpse.skipApproval')) {
            return false;
        }

        $posts = $this->config->approvalPosts();
        $days = $this->config->approvalDays();

        return ($posts > 0 && $actor->comment_count < $posts)
            || ($days > 0 && ($actor->joined_at === null || $actor->joined_at->greaterThan(Carbon::now()->subDays($days))));
    }
}
