/**
 * Sizes and centres the rotated camera preview inside its container.
 *
 * The camera is mounted sideways over the feeder, so the preview canvas is
 * rotated 90° in CSS. That swaps the axes: the canvas is laid out at
 * `width × height` but occupies `height × width` on screen, which is why the
 * container's width is compared against the video's height and vice versa.
 *
 * Contain, not cover. Cover crops whatever does not fit, and the first thing
 * off the edge is the border of the frame — which is exactly where the
 * detection outline sits. At window sizes where the container's aspect drifts
 * from the camera's, the operator was watching a preview with the scan region
 * cut off the side. Letterboxing is the lesser cost.
 *
 * Rotation does not affect the centring: `rotate(90deg)` turns the element
 * about its own centre, so placing the layout box centrally places the visual
 * result centrally too.
 */
export interface PreviewFit {
  /** Layout width of the canvas, before rotation. */
  cssW: number;
  /** Layout height of the canvas, before rotation. */
  cssH: number;
  left: number;
  top: number;
}

export function fitRotatedPreview(
  container: { width: number; height: number },
  video: { width: number; height: number },
): PreviewFit {
  const scale = Math.min(
    container.width / video.height,
    container.height / video.width,
  );
  const cssW = Math.round(video.width * scale);
  const cssH = Math.round(video.height * scale);
  return {
    cssW,
    cssH,
    left: (container.width - cssW) / 2,
    top: (container.height - cssH) / 2,
  };
}
