<?php

declare(strict_types=1);

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Schema\Builder;

// Highlights: a member's named collections of stories, kept after the stories expire.
return [
    'up' => function (Builder $schema): void {
        $schema->create('glimpse_highlights', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedInteger('user_id');
            $table->string('title', 40);
            $table->unsignedSmallInteger('position')->default(0);
            $table->dateTime('created_at');
            $table->dateTime('updated_at')->nullable();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index(['user_id', 'position']);
        });

        $schema->create('glimpse_highlight_stories', function (Blueprint $table): void {
            $table->unsignedInteger('highlight_id');
            $table->unsignedInteger('story_id');
            $table->unsignedSmallInteger('position')->default(0);

            $table->primary(['highlight_id', 'story_id']);
            $table->foreign('highlight_id')->references('id')->on('glimpse_highlights')->cascadeOnDelete();
            $table->foreign('story_id')->references('id')->on('glimpse_stories')->cascadeOnDelete();
            $table->index('story_id');
        });
    },
    'down' => function (Builder $schema): void {
        $schema->dropIfExists('glimpse_highlight_stories');
        $schema->dropIfExists('glimpse_highlights');
    },
];
