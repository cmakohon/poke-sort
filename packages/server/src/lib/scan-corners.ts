import type { ScanCorners } from "@poke-sort/shared";
import { z } from "zod";

/**
 * A corner as a fraction of the frame. Unsigned and clamped to the frame,
 * unlike the scan region's offsets — a corner outside the image has nothing
 * to sample.
 */
const cornerPoint = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .strict();

/**
 * The four-corner scan region, as both the settings API and the calibration
 * document express it. Labels are card-relative, not frame-relative — see
 * ScanCorners in shared.
 */
export const ScanCornersSchema = z
  .object({
    topLeft: cornerPoint,
    topRight: cornerPoint,
    bottomRight: cornerPoint,
    bottomLeft: cornerPoint,
  })
  .strict();

/**
 * Read corners back out of the jsonb column.
 *
 * Validated rather than cast: a row written by a future build with extra keys,
 * or hand-edited to something else entirely, resolves to null here — which the
 * client already handles by falling back to the legacy region — instead of
 * reaching the perspective warp as garbage geometry.
 */
export function parseScanCorners(value: unknown): ScanCorners | null {
  if (value == null) return null;
  const parsed = ScanCornersSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
