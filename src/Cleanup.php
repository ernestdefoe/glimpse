<?php

declare(strict_types=1);

namespace ErnestDefoe\Glimpse;

use ErnestDefoe\Glimpse\Media\Storage;
use Illuminate\Database\ConnectionInterface;

/**
 * Deletes stories and uploads with everything that hangs off them, set-wise.
 *
 * The foreign keys cascade on MySQL and PostgreSQL, but SQLite only enforces them when a forum turns
 * that on, so the dependent rows are deleted here explicitly: the same result on every database. Rows
 * go in one transaction; files go only after it commits.
 */
class Cleanup
{
    public function __construct(private readonly ConnectionInterface $db, private readonly Storage $storage)
    {
    }

    /** @param list<int> $storyIds */
    public function stories(array $storyIds): void
    {
        if ($storyIds === []) {
            return;
        }

        $mediaIds = Ids::of(Story::query()->whereIn('id', $storyIds)->pluck('media_id'));
        $paths = $this->paths($mediaIds);

        $this->db->transaction(function () use ($storyIds, $mediaIds): void {
            foreach (['glimpse_views', 'glimpse_mentions', 'glimpse_reports', 'glimpse_highlight_stories'] as $table) {
                $this->db->table($table)->whereIn('story_id', $storyIds)->delete();
            }
            Story::query()->whereIn('id', $storyIds)->delete();
            StoryMedia::query()->whereIn('id', $mediaIds)->delete();
        });

        $this->storage->delete($paths);
    }

    /** @param list<int> $mediaIds uploads no story uses */
    public function uploads(array $mediaIds): void
    {
        $paths = $this->paths($mediaIds);
        StoryMedia::query()->whereIn('id', $mediaIds)->delete();
        $this->storage->delete($paths);
    }

    /**
     * A member's files, listed before their account is deleted: on MySQL and PostgreSQL the foreign
     * keys remove the rows with the account, and the paths with them.
     *
     * @return list<string>
     */
    public function memberFiles(int $userId): array
    {
        return array_values(array_filter(StoryMedia::query()->where('user_id', $userId)->pluck('path')->all(), is_string(...)));
    }

    /**
     * Everything a member posted, once their account is deleted.
     *
     * @param list<string> $files from memberFiles(), taken before the account went
     */
    public function member(int $userId, array $files): void
    {
        $this->stories(Ids::of(Story::query()->where('user_id', $userId)->pluck('id')));
        $this->uploads(Ids::of(StoryMedia::query()->where('user_id', $userId)->pluck('id')));
        $this->storage->delete($files);
        $this->db->transaction(function () use ($userId): void {
            $this->db->table('glimpse_highlights')->where('user_id', $userId)->delete();
            $this->db->table('glimpse_mutes')->where('user_id', $userId)->orWhere('muted_user_id', $userId)->delete();
            $this->db->table('glimpse_views')->where('user_id', $userId)->delete();
            $this->db->table('glimpse_mentions')->where('user_id', $userId)->delete();
            $this->db->table('glimpse_reports')->where('user_id', $userId)->delete();
        });
    }

    /**
     * @param list<int> $mediaIds
     * @return list<string>
     */
    private function paths(array $mediaIds): array
    {
        return $mediaIds === [] ? [] : array_values(array_filter(StoryMedia::query()->whereIn('id', $mediaIds)->pluck('path')->all(), is_string(...)));
    }
}
