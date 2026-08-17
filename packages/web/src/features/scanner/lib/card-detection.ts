import { CARD_ASPECT_RATIO } from "@/features/scanner/constants";
import {
  DEFAULT_SCAN_REGION,
  type CardContour,
  type DetectionResult,
  type ScanCorners,
  type ScanRegion,
} from "@poke-sort/shared";

/**
 * Returns a fixed card-sized region within the frame, used in place of
 * per-frame edge detection. Cards are a known, constant physical size and
 * the camera is mounted in a fixed position over the sorter's module 1
 * platform, so a hardcoded region avoids the lighting/contrast failures of
 * contour detection (e.g. light-bordered cards against a light surface).
 *
 * This is the LEGACY region shape - a rigid card-aspect rectangle, optionally
 * turned. It survives as the seed for the corner editor and the fallback for
 * installs that have never opened it; scanCornersToContour below is what
 * capture actually uses once corners are saved.
 *
 * Raw camera frames are landscape; the desktop scanning UI rotates the
 * canvas 90° via CSS for portrait viewing (see card-scanner.tsx), so the
 * card sits in the *raw* frame rotated. The corners returned here are
 * therefore labelled frame-relative, not card-relative - `topLeft` is the
 * top-left of the box in the raw frame, which on a sideways camera is one of
 * the card's *side* corners. cornersFromScanRegion below relabels them.
 */
export function getDefaultCardContour(
  width: number,
  height: number,
  region: ScanRegion = DEFAULT_SCAN_REGION,
): CardContour {
  const cardAspect = 1 / CARD_ASPECT_RATIO;
  let boxH = height * region.coverage;
  let boxW = boxH * cardAspect;
  if (boxW > width * region.coverage) {
    boxW = width * region.coverage;
    boxH = boxW / cardAspect;
  }
  const left = (width - boxW) / 2 + region.offsetX * width;
  const top = (height - boxH) / 2 + region.offsetY * height;

  // Turn the box about its own centre, so rotating never moves the region the
  // operator has already lined up - the two adjustments stay independent.
  const cx = left + boxW / 2;
  const cy = top + boxH / 2;
  const angle = ((region.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corner = (x: number, y: number) => {
    const dx = x - cx;
    const dy = y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };

  return {
    topLeft: corner(left, top),
    topRight: corner(left + boxW, top),
    bottomRight: corner(left + boxW, top + boxH),
    bottomLeft: corner(left, top + boxH),
  };
}

/**
 * Relabel a legacy ScanRegion's box as card-relative corners, normalised to
 * fractions of the frame.
 *
 * The seed for the corner editor and the fallback for any install that has
 * never opened it, so an upgrade starts from exactly the box it had before.
 *
 * The relabelling is the whole point. getDefaultCardContour names its corners
 * frame-relative, and the camera is mounted sideways: the preview draws the
 * feed turned 90° CW, mapping a raw point to (1 - rawY/H, rawX/W). Under that
 * map the preview's top-left - the card's top-left, as the operator sees it -
 * is the raw frame's *bottom*-left, and the rest follow round.
 */
export function cornersFromScanRegion(
  width: number,
  height: number,
  region: ScanRegion = DEFAULT_SCAN_REGION,
): ScanCorners {
  const box = getDefaultCardContour(width, height, region);
  const frac = (p: { x: number; y: number }) => ({
    x: p.x / width,
    y: p.y / height,
  });
  return {
    topLeft: frac(box.bottomLeft),
    topRight: frac(box.topLeft),
    bottomRight: frac(box.topRight),
    bottomLeft: frac(box.bottomRight),
  };
}

/** Card-relative corner fractions back out to raw frame pixels. */
export function scanCornersToContour(
  corners: ScanCorners,
  width: number,
  height: number,
): CardContour {
  const px = (p: { x: number; y: number }) => ({
    x: p.x * width,
    y: p.y * height,
  });
  return {
    topLeft: px(corners.topLeft),
    topRight: px(corners.topRight),
    bottomRight: px(corners.bottomRight),
    bottomLeft: px(corners.bottomLeft),
  };
}

/**
 * The scan quad in raw frame pixels, from whichever of the two calibrations an
 * install has. One place decides, so the live preview overlay and the capture
 * can never disagree about where the region is.
 */
export function resolveCardContour(
  width: number,
  height: number,
  corners: ScanCorners | null | undefined,
  region: ScanRegion = DEFAULT_SCAN_REGION,
): CardContour {
  return scanCornersToContour(
    corners ?? cornersFromScanRegion(width, height, region),
    width,
    height,
  );
}

interface ProjectiveMap {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g: number;
  h: number;
}

/**
 * Heckbert's closed form for the projective map taking the unit square to an
 * arbitrary quadrilateral: (u,v) -> ((au+bv+c)/(gu+hv+1), (du+ev+f)/(gu+hv+1)),
 * with (u,v) running (0,0) -> topLeft, (1,0) -> topRight, (1,1) -> bottomRight,
 * (0,1) -> bottomLeft.
 *
 * Closed form rather than an 8x8 solve: the source square's corners are known
 * constants, which collapses the general system to these few lines.
 */
function unitSquareToQuad(quad: CardContour): ProjectiveMap {
  const { x: x0, y: y0 } = quad.topLeft;
  const { x: x1, y: y1 } = quad.topRight;
  const { x: x2, y: y2 } = quad.bottomRight;
  const { x: x3, y: y3 } = quad.bottomLeft;

  const affine: ProjectiveMap = {
    a: x1 - x0,
    b: x3 - x0,
    c: x0,
    d: y1 - y0,
    e: y3 - y0,
    f: y0,
    g: 0,
    h: 0,
  };

  const dx3 = x0 - x1 + x2 - x3;
  const dy3 = y0 - y1 + y2 - y3;
  // A parallelogram closes on itself, so the projective terms are exactly zero
  // and the affine reading above is the answer. Solving for them anyway would
  // divide by a determinant that vanishes in the same case.
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) return affine;

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  // Degenerate quad - three corners collinear, or two dragged onto each other.
  // Nothing sensible to warp, but the affine reading at least yields finite
  // numbers instead of filling the capture with NaN.
  if (Math.abs(den) < 1e-9) return affine;

  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  return {
    a: x1 - x0 + g * x1,
    b: x3 - x0 + h * x3,
    c: x0,
    d: y1 - y0 + g * y1,
    e: y3 - y0 + h * y3,
    f: y0,
    g,
    h,
  };
}

/**
 * Extract the card region from a canvas, straightened to a fixed-size portrait
 * output.
 *
 * `contour` is a general quadrilateral with CARD-relative corner labels, so
 * this is a real perspective warp: the camera looks at the platform from an
 * angle and a card's outline in the frame is a trapezoid, not a turned
 * rectangle. Canvas 2D transforms are affine only and cannot express that, so
 * the resampling is done per-pixel here.
 *
 * Because the corners carry the card's own orientation, the 90° turn the
 * sideways-mounted camera imposes falls out of the same warp - there is no
 * separate rotate-to-portrait pass.
 *
 * Cost is one pass over the 745x1043 output, tens of milliseconds, once per
 * captured card behind the settle delay. Not a per-frame path.
 */
export function extractCardImage(
  sourceCanvas: HTMLCanvasElement,
  contour: CardContour,
  outputWidth = 745,
): HTMLCanvasElement {
  const outputHeight = Math.round(outputWidth / CARD_ASPECT_RATIO);
  const map = unitSquareToQuad(contour);

  const corners = [
    contour.topLeft,
    contour.topRight,
    contour.bottomRight,
    contour.bottomLeft,
  ];
  // Only the quad's own neighbourhood is ever sampled, so read that rather
  // than the whole frame - getImageData on 1080p copies 8MB, and the region is
  // a fraction of it. One pixel of margin keeps every bilinear tap in bounds.
  const sx = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))) - 1);
  const sy = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))) - 1);
  const sw =
    Math.min(
      sourceCanvas.width,
      Math.ceil(Math.max(...corners.map((p) => p.x))) + 1,
    ) - sx;
  const sh =
    Math.min(
      sourceCanvas.height,
      Math.ceil(Math.max(...corners.map((p) => p.y))) + 1,
    ) - sy;

  const srcCtx = sourceCanvas.getContext("2d");
  if (!srcCtx) throw new Error("Could not get canvas context");
  const srcData = srcCtx.getImageData(sx, sy, sw, sh).data;

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;
  const outCtx = outputCanvas.getContext("2d");
  if (!outCtx) throw new Error("Could not get canvas context");
  const out = outCtx.createImageData(outputWidth, outputHeight);
  const outData = out.data;

  const du = 1 / outputWidth;
  const stepX = map.a * du;
  const stepY = map.d * du;
  const stepW = map.g * du;
  const maxX = sw - 1;
  const maxY = sh - 1;
  let o = 0;

  for (let py = 0; py < outputHeight; py++) {
    const v = (py + 0.5) / outputHeight;
    // Step along the row instead of re-evaluating the map: with v fixed every
    // term is linear in u, so one add each replaces three multiplies. The
    // divide has to stay per-pixel - it is what makes the map projective.
    let nx = map.a * du * 0.5 + map.b * v + map.c;
    let ny = map.d * du * 0.5 + map.e * v + map.f;
    let nw = map.g * du * 0.5 + map.h * v + 1;

    for (
      let px = 0;
      px < outputWidth;
      px++, nx += stepX, ny += stepY, nw += stepW, o += 4
    ) {
      const fx = nx / nw - sx;
      const fy = ny / nw - sy;
      // Clamp to the read window before interpolating, so a corner parked on
      // the very edge of the frame samples the edge pixel rather than reading
      // off the end of the buffer.
      const cx = fx < 0 ? 0 : fx > maxX ? maxX : fx;
      const cy = fy < 0 ? 0 : fy > maxY ? maxY : fy;
      const x0 = cx | 0;
      const y0 = cy | 0;
      const x1 = x0 < maxX ? x0 + 1 : x0;
      const y1 = y0 < maxY ? y0 + 1 : y0;
      const tx = cx - x0;
      const ty = cy - y0;

      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;

      outData[o] =
        srcData[i00] * w00 +
        srcData[i10] * w10 +
        srcData[i01] * w01 +
        srcData[i11] * w11;
      outData[o + 1] =
        srcData[i00 + 1] * w00 +
        srcData[i10 + 1] * w10 +
        srcData[i01 + 1] * w01 +
        srcData[i11 + 1] * w11;
      outData[o + 2] =
        srcData[i00 + 2] * w00 +
        srcData[i10 + 2] * w10 +
        srcData[i01 + 2] * w01 +
        srcData[i11 + 2] * w11;
      outData[o + 3] = 255;
    }
  }

  outCtx.putImageData(out, 0, 0);
  return outputCanvas;
}

/**
 * Scan row-wise vertical gradients to find the y-position of a strong
 * horizontal edge within a vertical band [yMinFrac, yMaxFrac].
 * Returns the row index and its gradient score.
 */
function findEdgeRow(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  yMinFrac: number,
  yMaxFrac: number,
): { row: number; score: number } {
  const xLeft = Math.floor(width * 0.1);
  const xRight = Math.floor(width * 0.9);
  const span = xRight - xLeft;
  const yMin = Math.floor(height * yMinFrac);
  const yMax = Math.floor(height * yMaxFrac);

  let bestRow = Math.floor(height * ((yMinFrac + yMaxFrac) / 2));
  let bestScore = 0;

  for (let y = yMin; y < yMax && y + 1 < height; y++) {
    let sum = 0;
    for (let x = xLeft; x < xRight; x++) {
      const i = (y * width + x) * 4;
      const j = ((y + 1) * width + x) * 4;
      sum +=
        (Math.abs(data[i] - data[j]) +
          Math.abs(data[i + 1] - data[j + 1]) +
          Math.abs(data[i + 2] - data[j + 2])) /
        3;
    }
    const score = sum / span;
    if (score > bestScore) {
      bestScore = score;
      bestRow = y;
    }
  }

  return { row: bestRow, score: bestScore };
}

/**
 * Detect the art region within a warped card canvas.
 *
 * Regular cards have a strong horizontal edge at the type-line separator
 * (~45–65% of card height). Full-art cards lack this edge, so we fall back
 * to treating almost the entire card face as art.
 */
function detectArtBounds(canvas: HTMLCanvasElement): {
  top: number;
  left: number;
  bottom: number;
  right: number;
} {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { top: 0.12, left: 0.06, bottom: 0.57, right: 0.94 };

  const { data } = ctx.getImageData(0, 0, W, H);

  // Look for the type-line bar that separates art from the text box
  const typeLine = findEdgeRow(data, W, H, 0.45, 0.65);

  // No strong separator → full-art card
  if (typeLine.score < 15) {
    return { top: 0.03, left: 0.03, bottom: 0.97, right: 0.97 };
  }

  // Find the name-bar bottom edge to set the art top boundary
  const nameBar = findEdgeRow(data, W, H, 0.08, 0.16);

  return {
    top: nameBar.row / H,
    left: 0.06,
    bottom: typeLine.row / H,
    right: 0.94,
  };
}

/**
 * Extract just the art region from a perspective-warped card canvas.
 * Automatically handles both regular and full-art cards.
 */
export function extractArtRegion(
  warpedCanvas: HTMLCanvasElement,
): HTMLCanvasElement {
  const W = warpedCanvas.width;
  const H = warpedCanvas.height;
  const { top, left, bottom, right } = detectArtBounds(warpedCanvas);

  const artLeft = Math.floor(left * W);
  const artTop = Math.floor(top * H);
  const artRight = Math.floor(right * W);
  const artBottom = Math.floor(bottom * H);
  const artW = artRight - artLeft;
  const artH = artBottom - artTop;

  const artCanvas = document.createElement("canvas");
  artCanvas.width = artW;
  artCanvas.height = artH;
  artCanvas
    .getContext("2d")!
    .drawImage(warpedCanvas, artLeft, artTop, artW, artH, 0, 0, artW, artH);
  return artCanvas;
}

/**
 * Convert a canvas to a JPEG blob for upload.
 */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality = 0.95,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to create blob from canvas"));
      },
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Draw the detection overlay (rounded quadrilateral border) on a canvas context.
 * Uses the CSS --primary color from the page.
 */
export function drawDetectionOverlay(
  ctx: CanvasRenderingContext2D,
  result: DetectionResult,
): void {
  if (!result.detected || !result.contour) return;

  const { topLeft, topRight, bottomRight, bottomLeft } = result.contour;
  const corners = [topLeft, topRight, bottomRight, bottomLeft];

  // Read the --primary CSS variable and convert to a usable color
  const primaryRaw = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim();
  const color = primaryRaw ? `${primaryRaw}` : "#6d28d9";

  const lineWidth = 12;
  const radius = 16;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Draw a rounded polygon using arcTo at each corner
  ctx.beginPath();
  for (let i = 0; i < corners.length; i++) {
    const prev = corners[(i - 1 + corners.length) % corners.length];
    const curr = corners[i];
    const next = corners[(i + 1) % corners.length];

    if (i === 0) {
      // Start midpoint between prev and curr
      const mx = (prev.x + curr.x) / 2;
      const my = (prev.y + curr.y) / 2;
      ctx.moveTo(mx, my);
    }

    ctx.arcTo(curr.x, curr.y, next.x, next.y, radius);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.restore();
}
