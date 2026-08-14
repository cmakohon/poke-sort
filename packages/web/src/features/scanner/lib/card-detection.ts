import { CARD_ASPECT_RATIO } from "@/features/scanner/constants";
import {
  DEFAULT_SCAN_REGION,
  type CardContour,
  type DetectionResult,
  type ScanRegion,
} from "@poke-sort/shared";

/**
 * Returns a fixed card-sized region within the frame, used in place of
 * per-frame edge detection. Cards are a known, constant physical size and
 * the camera is mounted in a fixed position over the sorter's module 1
 * platform, so a hardcoded region avoids the lighting/contrast failures of
 * contour detection (e.g. light-bordered cards against a light surface).
 *
 * Raw camera frames are landscape; the desktop scanning UI rotates the
 * canvas 90° via CSS for portrait viewing (see card-scanner.tsx), so the
 * card sits in the *raw* frame rotated - same assumption extractCardImage's
 * isLandscape branch below already relies on.
 *
 * `region` (coverage + offsetX/offsetY + rotation, the first three as
 * fractions of the frame) is calibrated per-org in the app's calibration
 * screen to match a given camera's field of view and mounting - see
 * features/calibration/components/scan-region-calibration-panel.tsx.
 *
 * With a non-zero rotation the returned quadrilateral is no longer
 * axis-aligned. It is still a rectangle - rotation is rigid, so the corners
 * stay square and the edges keep their lengths - which is what lets
 * extractCardImage below undo it with a rotation rather than a homography.
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
 * Extract the card region from a canvas, straightened to a fixed-size
 * portrait output. `contour` always comes from getDefaultCardContour above,
 * which only ever produces a rectangle - possibly turned, never skewed - so
 * this is a crop plus a rotation, not a general four-point perspective warp.
 * If a contour source that can return a skewed quadrilateral is ever
 * reintroduced (e.g. per-frame edge detection), this needs a real homography
 * again.
 */
export function extractCardImage(
  sourceCanvas: HTMLCanvasElement,
  contour: CardContour,
  outputWidth = 745,
): HTMLCanvasElement {
  const outputHeight = Math.round(outputWidth / CARD_ASPECT_RATIO);

  // Measured along the region's own edges rather than off the corners'
  // coordinates: once the box can be turned, topRight.x - topLeft.x is the
  // width of its shadow on the x axis, not the width of the box.
  const edgeX = {
    x: contour.topRight.x - contour.topLeft.x,
    y: contour.topRight.y - contour.topLeft.y,
  };
  const boxW = Math.hypot(edgeX.x, edgeX.y);
  const boxH = Math.hypot(
    contour.bottomLeft.x - contour.topLeft.x,
    contour.bottomLeft.y - contour.topLeft.y,
  );
  const angle = Math.atan2(edgeX.y, edgeX.x);
  const cx = (contour.topLeft.x + contour.bottomRight.x) / 2;
  const cy = (contour.topLeft.y + contour.bottomRight.y) / 2;

  // If the card bounding box is wider than tall, it's landscape in the frame.
  // Crop into a landscape canvas matching that ratio, then rotate 90° CW to
  // portrait so extractArtRegion receives a correctly-oriented image and
  // nothing gets squished.
  const isLandscape = boxW > boxH;
  const cropW = isLandscape ? outputHeight : outputWidth;
  const cropH = isLandscape ? outputWidth : outputHeight;

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  const cropCtx = cropCanvas.getContext("2d");
  if (!cropCtx) throw new Error("Could not get canvas context");
  cropCtx.imageSmoothingQuality = "high";
  // Read right to left: put the region's centre at the origin, turn the frame
  // back by the region's own angle, scale the box to the output, then move the
  // origin to the middle of the output. Everything outside the box falls
  // outside the canvas and is clipped. At angle 0 this is exactly the crop
  // this function used to do.
  cropCtx.translate(cropW / 2, cropH / 2);
  cropCtx.scale(cropW / boxW, cropH / boxH);
  cropCtx.rotate(-angle);
  cropCtx.translate(-cx, -cy);
  cropCtx.drawImage(sourceCanvas, 0, 0);
  cropCtx.setTransform(1, 0, 0, 1, 0, 0);

  if (!isLandscape) return cropCanvas;

  // Rotate the landscape crop 90° CW to produce a portrait canvas.
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;
  const outCtx = outputCanvas.getContext("2d");
  if (!outCtx) throw new Error("Could not get canvas context");
  outCtx.translate(outputWidth / 2, outputHeight / 2);
  outCtx.rotate(Math.PI / 2);
  outCtx.drawImage(cropCanvas, -cropW / 2, -cropH / 2);
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
