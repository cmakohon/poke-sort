import { MTG_ASPECT_RATIO } from "@/features/scanner/constants";
import {
  DEFAULT_SCAN_REGION,
  type CardContour,
  type DetectionResult,
  type ScanRegion,
} from "@magic-vault/shared";

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
 * `region` (coverage + offsetX/offsetY, all fractions of the frame) is
 * calibrated per-org in the app's calibration screen to match a given
 * camera's field of view and mounting - see
 * features/calibration/components/scan-region-calibration-panel.tsx.
 */
export function getDefaultCardContour(
  width: number,
  height: number,
  region: ScanRegion = DEFAULT_SCAN_REGION,
): CardContour {
  const cardAspect = 1 / MTG_ASPECT_RATIO;
  let boxH = height * region.coverage;
  let boxW = boxH * cardAspect;
  if (boxW > width * region.coverage) {
    boxW = width * region.coverage;
    boxH = boxW / cardAspect;
  }
  const left = (width - boxW) / 2 + region.offsetX * width;
  const top = (height - boxH) / 2 + region.offsetY * height;

  return {
    topLeft: { x: left, y: top },
    topRight: { x: left + boxW, y: top },
    bottomRight: { x: left + boxW, y: top + boxH },
    bottomLeft: { x: left, y: top + boxH },
  };
}

/**
 * Extract and perspective-warp the detected card region from a canvas.
 */
export function extractCardImage(
  sourceCanvas: HTMLCanvasElement,
  contour: CardContour,
  outputWidth = 745,
): HTMLCanvasElement {
  const outputHeight = Math.round(outputWidth / MTG_ASPECT_RATIO);

  // If the card bounding box is wider than tall, it's landscape in the frame.
  // Warp to a landscape canvas matching that ratio, then rotate 90° CW to portrait
  // so extractArtRegion receives a correctly-oriented image and nothing gets squished.
  const xs = [
    contour.topLeft.x,
    contour.topRight.x,
    contour.bottomRight.x,
    contour.bottomLeft.x,
  ];
  const ys = [
    contour.topLeft.y,
    contour.topRight.y,
    contour.bottomRight.y,
    contour.bottomLeft.y,
  ];
  const isLandscape =
    Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys);

  const warpW = isLandscape ? outputHeight : outputWidth;
  const warpH = isLandscape ? outputWidth : outputHeight;

  const ctx = sourceCanvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");

  const imageData = ctx.getImageData(
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  const src = cv.matFromImageData(imageData);
  const dst = new cv.Mat();

  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    contour.topLeft.x,
    contour.topLeft.y,
    contour.topRight.x,
    contour.topRight.y,
    contour.bottomRight.x,
    contour.bottomRight.y,
    contour.bottomLeft.x,
    contour.bottomLeft.y,
  ]);

  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    warpW,
    0,
    warpW,
    warpH,
    0,
    warpH,
  ]);

  let transformMatrix: cv.Mat | null = null;

  try {
    transformMatrix = cv.getPerspectiveTransform(srcPts, dstPts);
    cv.warpPerspective(src, dst, transformMatrix, new cv.Size(warpW, warpH));

    const warpCanvas = document.createElement("canvas");
    warpCanvas.width = warpW;
    warpCanvas.height = warpH;
    cv.imshow(warpCanvas, dst);

    if (!isLandscape) return warpCanvas;

    // Rotate the landscape warp result 90° CW to produce a portrait canvas.
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;
    const outCtx = outputCanvas.getContext("2d")!;
    outCtx.translate(outputWidth / 2, outputHeight / 2);
    outCtx.rotate(Math.PI / 2);
    outCtx.drawImage(warpCanvas, -warpW / 2, -warpH / 2);
    return outputCanvas;
  } finally {
    src.delete();
    dst.delete();
    srcPts.delete();
    dstPts.delete();
    transformMatrix?.delete();
  }
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
