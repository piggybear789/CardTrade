import 'server-only';

// lib/moderation/scanImage.ts
//
// Runs Rekognition DetectModerationLabels on bytes we are about to publish
// (listing photos, avatars). The original Storage object is left intact — we
// only downscale a copy so it fits Rekognition's 5 MB JPEG/PNG bytes limit.
//
// Credentials: the same AWS chain as SES (AWS_ACCESS_KEY_ID / secret, or a
// role). IAM needs rekognition:DetectModerationLabels. Region follows
// AWS_REKOGNITION_REGION → AWS_REGION → AWS_SES_REGION → ap-southeast-2.
//
// Fail OPEN on outages and missing credentials so a Sydney blip does not freeze
// the catalog. Fail CLOSED only on an explicit policy reject.
//
// Set IMAGE_MODERATION_DISABLED=1 to skip the call entirely (local / e2e).

import {
  DetectModerationLabelsCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import sharp from 'sharp';

import type { createAdminClient } from '@/lib/supabase/admin';
import {
  ImageRejectedError,
  MODERATION_MIN_CONFIDENCE,
  decideImageModeration,
} from '@/lib/moderation/policy';

type AdminClient = ReturnType<typeof createAdminClient>;

/** Rekognition Image bytes API limit. */
const REKOGNITION_MAX_BYTES = 5 * 1024 * 1024;
/** Long-edge cap for the scan copy — enough for labels, cheap to send. */
const SCAN_MAX_EDGE = 1920;

let _client: RekognitionClient | null = null;

function moderationDisabled(): boolean {
  return process.env.IMAGE_MODERATION_DISABLED === '1';
}

function getRekognitionClient(): RekognitionClient {
  if (_client) return _client;
  const region =
    process.env.AWS_REKOGNITION_REGION ??
    process.env.AWS_REGION ??
    process.env.AWS_SES_REGION ??
    'ap-southeast-2';
  _client = new RekognitionClient({ region });
  return _client;
}

/**
 * Build a JPEG Rekognition can accept. Does not mutate the stored original.
 * Returns null when the bytes are not a readable image — caller fails open.
 */
async function jpegForRekognition(bytes: Buffer): Promise<Buffer | null> {
  try {
    const jpeg = await sharp(bytes, { failOn: 'none', animated: false })
      .rotate()
      .resize({
        width: SCAN_MAX_EDGE,
        height: SCAN_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();
    if (jpeg.length === 0 || jpeg.length > REKOGNITION_MAX_BYTES) return null;
    return jpeg;
  } catch {
    return null;
  }
}

/**
 * Ask Rekognition whether these pixels may be published. Throws
 * {@link ImageRejectedError} on an explicit reject. Swallows AWS / decode
 * failures so listings still save.
 */
export async function moderateImageBytes(bytes: Buffer): Promise<void> {
  if (moderationDisabled()) return;
  if (bytes.length === 0) return;

  const jpeg = await jpegForRekognition(bytes);
  if (!jpeg) return;

  try {
    const response = await getRekognitionClient().send(
      new DetectModerationLabelsCommand({
        Image: { Bytes: jpeg },
        MinConfidence: MODERATION_MIN_CONFIDENCE,
      }),
    );

    const decision = decideImageModeration({
      labels: response.ModerationLabels ?? [],
      contentTypes: response.ContentTypes,
    });
    if (decision === 'reject') {
      console.info('[image-moderation] rejected', {
        labels: (response.ModerationLabels ?? []).map((label) => ({
          name: label.Name,
          confidence: label.Confidence,
          parent: label.ParentName,
        })),
        contentTypes: response.ContentTypes,
      });
      throw new ImageRejectedError();
    }
  } catch (error) {
    if (error instanceof ImageRejectedError) throw error;
    console.error('[image-moderation] rekognition failed; allowing upload', error);
  }
}

/**
 * Download a just-uploaded public object, scan it, and delete it if rejected
 * so the public URL does not stay live.
 */
export async function moderateStoredPublicImage(
  admin: AdminClient,
  bucket: string,
  path: string,
): Promise<void> {
  if (moderationDisabled()) return;

  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) {
    console.error('[image-moderation] download failed; allowing upload', {
      bucket,
      path,
      message: error?.message,
    });
    return;
  }

  const bytes = Buffer.from(await data.arrayBuffer());
  try {
    await moderateImageBytes(bytes);
  } catch (error) {
    if (error instanceof ImageRejectedError) {
      try {
        await admin.storage.from(bucket).remove([path]);
      } catch {
        // Best-effort: the listing/avatar write will still be refused.
      }
    }
    throw error;
  }
}
