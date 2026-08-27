import { describe, expect, it } from "vitest";

import { fitRotatedPreview } from "./preview-fit";

/** What the rotated canvas actually occupies on screen: the axes are swapped. */
function onScreen(fit: { cssW: number; cssH: number }) {
  return { width: fit.cssH, height: fit.cssW };
}

describe("fitRotatedPreview", () => {
  it("keeps the whole frame inside the container", () => {
    const container = { width: 273, height: 293 };
    const box = onScreen(fitRotatedPreview(container, { width: 1920, height: 1080 }));
    expect(box.width).toBeLessThanOrEqual(container.width);
    expect(box.height).toBeLessThanOrEqual(container.height);
  });

  it("never crops, whatever shape the container takes", () => {
    const video = { width: 1920, height: 1080 };
    for (const container of [
      { width: 273, height: 293 },
      { width: 500, height: 120 },
      { width: 120, height: 500 },
      { width: 400, height: 400 },
    ]) {
      const box = onScreen(fitRotatedPreview(container, video));
      expect(box.width).toBeLessThanOrEqual(container.width + 1);
      expect(box.height).toBeLessThanOrEqual(container.height + 1);
    }
  });

  it("fills at least one axis, so the preview is as large as it can be", () => {
    const container = { width: 273, height: 293 };
    const box = onScreen(fitRotatedPreview(container, { width: 1920, height: 1080 }));
    const fills =
      Math.abs(box.width - container.width) <= 1 ||
      Math.abs(box.height - container.height) <= 1;
    expect(fills).toBe(true);
  });

  it("preserves the rotated aspect ratio", () => {
    const fit = fitRotatedPreview({ width: 273, height: 293 }, { width: 1920, height: 1080 });
    const box = onScreen(fit);
    expect(box.width / box.height).toBeCloseTo(1080 / 1920, 2);
  });

  it("centres the layout box, which centres the rotated result", () => {
    const container = { width: 400, height: 400 };
    const fit = fitRotatedPreview(container, { width: 1920, height: 1080 });
    expect(fit.left + fit.cssW / 2).toBeCloseTo(container.width / 2);
    expect(fit.top + fit.cssH / 2).toBeCloseTo(container.height / 2);
  });
});
