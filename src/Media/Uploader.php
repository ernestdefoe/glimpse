<?php

declare(strict_types=1);

namespace ErnestDefoe\Glimpse\Media;

use Carbon\Carbon;
use ErnestDefoe\Glimpse\Config;
use ErnestDefoe\Glimpse\StoryMedia;
use Flarum\Foundation\ValidationException;
use Flarum\Locale\TranslatorInterface;
use Flarum\User\User;
use Intervention\Image\Encoders\GifEncoder;
use Intervention\Image\Encoders\WebpEncoder;
use Intervention\Image\Exceptions\RuntimeException as ImageException;
use Intervention\Image\ImageManager;
use Psr\Http\Message\UploadedFileInterface;

/**
 * Turns an upload into a StoryMedia row and a clean file.
 *
 * - The size is checked before anything is read, against the upload's real size.
 * - The type comes from the bytes (Sniffer); the file name and the browser's claimed type are ignored.
 * - Photos are decoded and re-encoded (WebP; an animated GIF stays a GIF) with Intervention Image,
 *   which drops EXIF and GPS and anything hidden after the picture, and scaled down to fit 1440×2560.
 * - Videos are MP4 or WebM, kept as they are apart from their metadata, which is scrubbed
 *   (Mp4Scrubber / WebmScrubber), and refused when longer than the admin's limit.
 */
class Uploader
{
    public const MAX_WIDTH = 1440;

    public const MAX_HEIGHT = 2560;

    /** Pixels a header may claim before the decoder is trusted with it. */
    private const MAX_PIXELS = 40_000_000;

    public function __construct(
        private readonly Storage $storage,
        private readonly Config $config,
        private readonly ImageManager $images,
        private readonly TranslatorInterface $translator,
        private readonly Mp4Scrubber $mp4,
        private readonly WebmScrubber $webm,
    ) {
    }

    public function upload(User $actor, UploadedFileInterface $file): StoryMedia
    {
        if ($file->getError() !== UPLOAD_ERR_OK) {
            $this->fail('upload_failed');
        }

        $size = (int) $file->getSize();
        if ($size < 1 || $size > max($this->config->imageMaxBytes(), $this->config->videoMaxBytes())) {
            $this->fail('too_large');
        }

        $stream = $file->getStream();
        $stream->rewind();
        $type = Sniffer::sniff($stream->read(64));
        if ($type === null) {
            $this->fail('bad_type');
        }

        $max = $type['kind'] === 'image' ? $this->config->imageMaxBytes() : $this->config->videoMaxBytes();
        if ($size > $max) {
            $this->fail('too_large');
        }

        $stream->rewind();
        $bytes = $stream->getContents();

        $media = new StoryMedia();
        $media->user_id = $actor->id;
        $media->kind = $type['kind'];
        $media->created_at = Carbon::now();

        if ($type['kind'] === 'image') {
            [$encoded, $width, $height, $gif] = $this->image($bytes, $type['format'] === 'gif');
            $media->mime = $gif ? 'image/gif' : 'image/webp';
            $media->width = $width;
            $media->height = $height;
            $media->path = $this->storage->put($encoded, $gif ? 'gif' : 'webp');
            $media->size = strlen($encoded);
        } else {
            $clean = $type['format'] === 'mp4' ? $this->mp4->scrub($bytes) : $this->webm->scrub($bytes);
            if ($clean === null) {
                $this->fail('bad_type');
            }
            if ($clean['durationMs'] !== null && $clean['durationMs'] > $this->config->videoMaxSeconds() * 1000 + 500) {
                $this->fail('too_long', ['{max}' => $this->config->videoMaxSeconds()]);
            }
            $media->mime = $type['format'] === 'mp4' ? 'video/mp4' : 'video/webm';
            $media->duration_ms = $clean['durationMs'];
            $media->path = $this->storage->put($clean['bytes'], $type['format']);
            $media->size = strlen($clean['bytes']);
        }

        $media->save();

        return $media;
    }

    /** @return array{0: string, 1: int, 2: int, 3: bool} the encoded bytes, width, height, and whether it stayed a GIF */
    private function image(string $bytes, bool $gif): array
    {
        // Dimensions from the header before decoding, so a small file claiming to be huge never reaches the decoder.
        $info = @getimagesizefromstring($bytes);
        if ($info === false || $info[0] < 1 || $info[1] < 1 || $info[0] * $info[1] > self::MAX_PIXELS) {
            $this->fail('bad_type');
        }

        try {
            $image = $this->images->read($bytes);
        } catch (ImageException) {
            // Not a picture the decoder can read, whatever its first bytes said.
            $this->fail('bad_type');
        }

        $animated = $gif && $image->isAnimated();
        if (! $animated) {
            $image->orient();
        }
        $image->scaleDown(self::MAX_WIDTH, self::MAX_HEIGHT);

        $encoded = $animated
            ? (string) $image->encode(new GifEncoder())
            : (string) $image->encode(new WebpEncoder(quality: 82));

        return [$encoded, $image->width(), $image->height(), $animated];
    }

    /** @param array<string, int|string> $params */
    private function fail(string $key, array $params = []): never
    {
        throw new ValidationException(['file' => $this->translator->trans('ernestdefoe-glimpse.api.'.$key, $params)]);
    }
}
