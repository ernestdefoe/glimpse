<?php

declare(strict_types=1);

namespace ErnestDefoe\Glimpse\Approval;

use ErnestDefoe\Glimpse\Ids;
use Flarum\User\User;

/** With ernestdefoe/trust-levels: also hold stories from members below the admin's trust level. */
class TrustLevelApproval extends Approval
{
    public function holds(User $actor): bool
    {
        if (parent::holds($actor)) {
            return true;
        }

        $level = $this->config->approvalTrustLevel();

        return $level > 0
            && ! $actor->hasPermission('glimpse.skipApproval')
            && Ids::one($actor->getAttribute('trust_level')) < $level;
    }
}
