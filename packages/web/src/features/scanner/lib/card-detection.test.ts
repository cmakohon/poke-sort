import { getDefaultCardContour } from "@/features/scanner/lib/card-detection";
import { DEFAULT_SCAN_REGION, type CardContour } from "@poke-sort/shared";
import { describe, expect, it } from "vitest";

const FRAME = { width: 1920, height: 1080 };

const corners = (c: CardContour) => [
  c.topLeft,
  c.topRight,
  c.bottomRight,
  c.bottomLeft,
];

const edge = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(b.x - a.x, b.y - a.y);

const centre = (c: CardContour) => ({
  x: (c.topLeft.x + c.bottomRight.x) / 2,
  y: (c.topLeft.y + c.bottomRight.y) / 2,
});

describe("getDefaultCardContour rotation", () => {
  const square = getDefaultCardContour(FRAME.width, FRAME.height, {
    ...DEFAULT_SCAN_REGION,
    offsetX: -0.05,
    offsetY: -0.06,
  });

  it("is unchanged at zero, corner for corner", () => {
    const explicitZero = getDefaultCardContour(FRAME.width, FRAME.height, {
      ...DEFAULT_SCAN_REGION,
      offsetX: -0.05,
      offsetY: -0.06,
      rotation: 0,
    });
    expect(explicitZero).toEqual(square);
    // Zero rotation must stay axis-aligned: this is the box an unconfigured
    // install starts from, and a hair of rounding would seed the editor with a
    // quad that is already very slightly crooked.
    expect(square.topLeft.y).toBe(square.topRight.y);
    expect(square.topLeft.x).toBe(square.bottomLeft.x);
  });

  it("turns about the region's own centre, leaving it where it was", () => {
    const turned = getDefaultCardContour(FRAME.width, FRAME.height, {
      ...DEFAULT_SCAN_REGION,
      offsetX: -0.05,
      offsetY: -0.06,
      rotation: 7,
    });
    expect(centre(turned).x).toBeCloseTo(centre(square).x, 6);
    expect(centre(turned).y).toBeCloseTo(centre(square).y, 6);
  });

  it("keeps the box the same size and shape", () => {
    const turned = getDefaultCardContour(FRAME.width, FRAME.height, {
      ...DEFAULT_SCAN_REGION,
      offsetX: -0.05,
      offsetY: -0.06,
      rotation: -12.5,
    });
    // Rigid: same edge lengths, and still square at the corners. This is the
    // legacy seed path, and a seed that arrives already skewed would hand the
    // operator a quad to un-bend before they can start.
    expect(edge(turned.topLeft, turned.topRight)).toBeCloseTo(
      edge(square.topLeft, square.topRight),
      6,
    );
    expect(edge(turned.topLeft, turned.bottomLeft)).toBeCloseTo(
      edge(square.topLeft, square.bottomLeft),
      6,
    );
    const widthEdge = {
      x: turned.topRight.x - turned.topLeft.x,
      y: turned.topRight.y - turned.topLeft.y,
    };
    const heightEdge = {
      x: turned.bottomLeft.x - turned.topLeft.x,
      y: turned.bottomLeft.y - turned.topLeft.y,
    };
    expect(widthEdge.x * heightEdge.x + widthEdge.y * heightEdge.y).toBeCloseTo(
      0,
      6,
    );
  });

  it("turns clockwise for a positive angle", () => {
    // Screen coordinates: y grows downward, so a clockwise turn pushes the top
    // edge's right-hand corner down. Getting this backwards would make the
    // rotate handle fight the operator.
    const turned = getDefaultCardContour(FRAME.width, FRAME.height, {
      ...DEFAULT_SCAN_REGION,
      rotation: 10,
    });
    expect(turned.topRight.y).toBeGreaterThan(turned.topLeft.y);
  });

  it("treats a region with no rotation field as square", () => {
    // Rows stored before the column existed deserialise without it.
    const legacy = { coverage: 0.82, offsetX: -0.05, offsetY: -0.06 } as never;
    const contour = getDefaultCardContour(FRAME.width, FRAME.height, legacy);
    for (const point of corners(contour)) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
    expect(contour.topLeft.y).toBe(contour.topRight.y);
  });
});
