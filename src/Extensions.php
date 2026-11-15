<?php

declare(strict_types=1);

namespace ErnestDefoe\Glimpse;

use Flarum\Extension\ExtensionManager;

/**
 * Which optional extensions are switched on. Every use of another extension's tables or columns
 * asks here first, so Glimpse works the same with none of them installed.
 */
class Extensions
{
    /** @var array<string, bool> */
    private array $enabled = [];

    public function __construct(private readonly ExtensionManager $extensions)
    {
    }

    /** ianm/follow-users: its `user_followers` table (user_id follows followed_user_id). */
    public function follows(): bool
    {
        return $this->is('ianm-follow-users');
    }

    /** fof/ignore-users: its `ignored_user` table (user_id ignores ignored_user_id). */
    public function ignores(): bool
    {
        return $this->is('fof-ignore-users');
    }

    /** flarum/suspend: the `users.suspended_until` column. */
    public function suspend(): bool
    {
        return $this->is('flarum-suspend');
    }

    /** ernestdefoe/trust-levels: the `users.trust_level` column. */
    public function trustLevels(): bool
    {
        return $this->is('ernestdefoe-trust-levels');
    }

    private function is(string $id): bool
    {
        return $this->enabled[$id] ??= $this->extensions->isEnabled($id);
    }
}
