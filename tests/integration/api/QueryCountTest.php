<?php

declare(strict_types=1);

namespace ErnestDefoe\Glimpse\Tests\integration\api;

use Carbon\Carbon;
use ErnestDefoe\Glimpse\Tests\integration\GlimpseTestCase;
use PHPUnit\Framework\Attributes\Test;

/**
 * 🚨 The bar and the Stories page cost the same number of queries for 1 author or 30, for a guest
 * and for a member, with seen marks, reactions, follows, media and mentions in play.
 */
class QueryCountTest extends GlimpseTestCase
{
    private function seed(int $authors): void
    {
        $now = Carbon::now();
        $users = [];
        for ($id = 100; $id < 100 + $authors; $id++) {
            $users[] = ['id' => $id, 'username' => "poster$id", 'email' => "poster$id@machine.local", 'is_email_confirmed' => 1, 'password' => 'x'];
        }
        $this->database()->table('users')->insert($users);

        for ($id = 100; $id < 100 + $authors; $id++) {
            $mediaId = $this->database()->table('glimpse_media')->insertGetId(['user_id' => $id, 'kind' => 'image', 'mime' => 'image/webp', 'path' => '2026/11/'.str_pad(dechex($id), 32, '0', STR_PAD_LEFT).'.webp', 'width' => 10, 'height' => 10, 'size' => 10, 'created_at' => $now]);
            $photo = $this->insert($id, ['kind' => 'photo', 'text' => null, 'media_id' => $mediaId]);
            $text = $this->insert($id, ['caption' => 'hi @follower']);
            $this->database()->table('glimpse_mentions')->insert(['story_id' => $text, 'user_id' => 3]);
            $this->database()->table('glimpse_views')->insert(['story_id' => $photo, 'user_id' => 3, 'viewed_at' => $now, 'reaction' => '❤️']);
            $this->database()->table('user_followers')->insert(['user_id' => 3, 'followed_user_id' => $id, 'subscription' => 'follow']);
        }
    }

    private function queries(string $path, array $query, ?int $as): int
    {
        $request = $this->request('GET', $path, $as ? ['authenticatedAs' => $as] : [])->withQueryParams($query);
        $this->send($request); // warm: settings, permissions

        $count = 0;
        $this->database()->listen(function () use (&$count): void {
            $count++;
        });
        $response = $this->send($request);
        $this->assertSame(200, $response->getStatusCode(), substr((string) $response->getBody(), 0, 1000));

        return $count;
    }

    #[Test]
    public function the_bar_and_the_page_cost_the_same_for_one_author_or_thirty(): void
    {
        $this->seed(30);
        $bar = ['filter' => ['bar' => '1'], 'page' => ['limit' => 100, 'total' => 0]];
        $page = ['filter' => ['live' => '1'], 'page' => ['limit' => 24, 'total' => 0]];
        $one = ['filter' => ['author' => '100', 'live' => '1'], 'page' => ['limit' => 100, 'total' => 0]];

        foreach ([null, 3, 4] as $as) {
            $this->assertSame(
                $this->queries('/api/stories', $one, $as),
                $this->queries('/api/stories', $bar, $as),
                'The bar for 30 authors costs what one author does, as '.($as ?? 'guest')
            );
            $this->assertSame($this->queries('/api/stories', $one, $as), $this->queries('/api/stories', $page, $as));
        }
    }

    #[Test]
    public function the_forum_payload_counts_waiting_stories_for_moderators_only(): void
    {
        $member = $this->queries('/api', [], 4);
        $moderator = $this->queries('/api', [], 5);
        $this->assertSame(1, $moderator - $member);
    }
}
