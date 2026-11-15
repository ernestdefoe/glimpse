<?php

declare(strict_types=1);

namespace ErnestDefoe\Glimpse\Http;

use ErnestDefoe\Glimpse\Ids;
use ErnestDefoe\Glimpse\Media\Storage;
use ErnestDefoe\Glimpse\Story;
use ErnestDefoe\Glimpse\StoryMedia;
use Flarum\Http\RequestUtil;
use Flarum\User\Exception\PermissionDeniedException;
use Flarum\Http\Exception\RouteNotFoundException;
use Laminas\Diactoros\Response;
use Laminas\Diactoros\Stream;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * `GET /glimpse/media/{id}`: a story's photo or video, only for someone who may see a story using it
 * (the visibility rule), or who uploaded it (the preview before posting). Never cached by shared
 * caches, so hiding or deleting a story takes its file away at once. Supports byte ranges, which
 * Safari needs to play video.
 */
class MediaController implements RequestHandlerInterface
{
    public function __construct(private readonly Storage $storage)
    {
    }

    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        $actor = RequestUtil::getActor($request);
        $id = Ids::one($request->getQueryParams()['id'] ?? null);

        $media = StoryMedia::query()->find($id);
        if ($media === null) {
            throw new RouteNotFoundException();
        }

        $own = ! $actor->isGuest() && $media->user_id === $actor->id;
        if (! $own && ! Story::whereVisibleTo($actor)->where('glimpse_stories.media_id', $media->id)->exists()) {
            throw new PermissionDeniedException();
        }

        $disk = $this->storage->disk();
        $source = $disk->readStream($media->path);
        if (! is_resource($source)) {
            throw new RouteNotFoundException();
        }

        $size = $disk->size($media->path);
        [$start, $end] = $this->range($request->getHeaderLine('Range'), $size) ?? [0, $size - 1];
        $partial = $start > 0 || $end < $size - 1;

        if ($partial) {
            // Only the requested bytes, through a temporary stream (it spills to disk past 2 MB).
            $this->skip($source, $start);
            $target = fopen('php://temp', 'w+b');
            if ($target === false) {
                throw new RouteNotFoundException();
            }
            stream_copy_to_stream($source, $target, $end - $start + 1);
            fclose($source);
            rewind($target);
            $source = $target;
        }

        $headers = [
            'Content-Type' => $media->mime,
            'Content-Length' => (string) ($end - $start + 1),
            'Accept-Ranges' => 'bytes',
            'Cache-Control' => 'private, max-age=3600',
            'Content-Disposition' => 'inline',
        ];
        if ($partial) {
            $headers['Content-Range'] = "bytes {$start}-{$end}/{$size}";
        }

        return new Response(new Stream($source), $partial ? 206 : 200, $headers);
    }

    /** Moves a stream to $offset: a seek where the driver allows it, otherwise reading past the bytes. */
    private function skip(mixed $stream, int $offset): void
    {
        if ($offset < 1 || ! is_resource($stream)) {
            return;
        }
        if (stream_get_meta_data($stream)['seekable'] && fseek($stream, $offset) === 0) {
            return;
        }
        for ($left = $offset; $left > 0 && ! feof($stream);) {
            $chunk = fread($stream, min(65536, $left));
            if ($chunk === false || $chunk === '') {
                return;
            }
            $left -= strlen($chunk);
        }
    }

    /** @return array{0: int, 1: int}|null a single satisfiable byte range, or null for the whole file */
    private function range(string $header, int $size): ?array
    {
        if ($size < 1 || preg_match('/^bytes=(\d*)-(\d*)$/', trim($header), $m) !== 1 || ($m[1] === '' && $m[2] === '')) {
            return null;
        }

        if ($m[1] === '') {
            $start = max(0, $size - (int) $m[2]);
            $end = $size - 1;
        } else {
            $start = (int) $m[1];
            $end = $m[2] === '' ? $size - 1 : min((int) $m[2], $size - 1);
        }

        return $start <= $end && $start < $size ? [$start, $end] : null;
    }
}
