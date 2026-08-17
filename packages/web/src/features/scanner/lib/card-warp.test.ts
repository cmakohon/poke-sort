import {
  cornersFromScanRegion,
  extractCardImage,
  resolveCardContour,
  scanCornersToContour,
} from "@/features/scanner/lib/card-detection";
import { DEFAULT_SCAN_REGION, type CardContour } from "@poke-sort/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FRAME = { width: 1920, height: 1080 };

/**
 * A source canvas that encodes its own coordinates: red is x, green is y. Any
 * sample taken from it reports exactly where it came from, which is what lets
 * the warp assertions below name a source pixel instead of a colour.
 *
 * jsdom has no canvas backend, so the two contexts the warp touches are stood
 * up by hand rather than mocked at the call site — the code under test is the
 * pixel indexing, and a mock that skipped it would test nothing.
 */
function coordinateCanvas(width: number, height: number): HTMLCanvasElement {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = x;
      data[i + 1] = y;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  return {
    width,
    height,
    getContext: () => ({
      getImageData(sx: number, sy: number, sw: number, sh: number) {
        const out = new Uint8ClampedArray(sw * sh * 4);
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            const si = ((sy + y) * width + (sx + x)) * 4;
            out.set(data.subarray(si, si + 4), (y * sw + x) * 4);
          }
        }
        return { data: out, width: sw, height: sh };
      },
    }),
  } as unknown as HTMLCanvasElement;
}

let written: { data: Uint8ClampedArray; width: number; height: number } | null;

beforeEach(() => {
  written = null;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        createImageData: (w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
        putImageData: (img: { data: Uint8ClampedArray; width: number; height: number }) => {
          written = img;
        },
      }) as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => vi.restoreAllMocks());

/** The (x, y) the output pixel sampled, read back out of its own colour. */
function sampledAt(px: number, py: number, outWidth: number) {
  if (!written) throw new Error("nothing was written to the output canvas");
  const i = (py * outWidth + px) * 4;
  return { x: written.data[i], y: written.data[i + 1] };
}

/**
 * One output pixel spans several source pixels at these sizes, and the map is
 * sampled at pixel centres, so every expectation here is "within half an
 * output pixel of the source position" rather than an exact hit.
 */
const HALF_PIXEL = 4;

function expectNear(got: number, expected: number, tolerance = HALF_PIXEL) {
  expect(Math.abs(got - expected)).toBeLessThanOrEqual(tolerance);
}

describe("extractCardImage perspective warp", () => {
  const OUT_W = 40;
  const OUT_H = 56; // round(40 / (2.5/3.5))

  it("lands each output corner on its source corner", () => {
    // A trapezoid: the near edge of the card is wider than the far edge,
    // exactly the shape a camera looking down at an angle produces and the
    // shape the old rigid-rectangle crop could not follow.
    const quad: CardContour = {
      topLeft: { x: 20, y: 30 },
      topRight: { x: 160, y: 20 },
      bottomRight: { x: 170, y: 130 },
      bottomLeft: { x: 30, y: 120 },
    };
    extractCardImage(coordinateCanvas(200, 150), quad, OUT_W);

    const cases: [number, number, { x: number; y: number }][] = [
      [0, 0, quad.topLeft],
      [OUT_W - 1, 0, quad.topRight],
      [0, OUT_H - 1, quad.bottomLeft],
      [OUT_W - 1, OUT_H - 1, quad.bottomRight],
    ];
    for (const [px, py, expected] of cases) {
      const got = sampledAt(px, py, OUT_W);
      expectNear(got.x, expected.x);
      expectNear(got.y, expected.y);
    }
  });

  it("keeps a straight card edge straight", () => {
    // The point of the warp: a card edge that runs diagonally across the frame
    // has to come out as the output's straight left border. Sampling down that
    // border should walk the source edge at a constant rate.
    const quad: CardContour = {
      topLeft: { x: 20, y: 30 },
      topRight: { x: 160, y: 20 },
      bottomRight: { x: 170, y: 130 },
      bottomLeft: { x: 30, y: 120 },
    };
    extractCardImage(coordinateCanvas(200, 150), quad, OUT_W);

    const steps = [0, 1, 2, 3].map((i) =>
      sampledAt(0, Math.floor((i * (OUT_H - 1)) / 3), OUT_W),
    );
    const deltas = steps.slice(1).map((p, i) => p.y - steps[i].y);
    for (const d of deltas) expectNear(d, deltas[0]);
  });

  it("reproduces a plain rectangle as a straight crop", () => {
    // The affine branch. A quad with no perspective in it must not pick up any
    // from the projective solve.
    const quad: CardContour = {
      topLeft: { x: 40, y: 20 },
      topRight: { x: 140, y: 20 },
      bottomRight: { x: 140, y: 160 },
      bottomLeft: { x: 40, y: 160 },
    };
    extractCardImage(coordinateCanvas(200, 200), quad, OUT_W);

    // Every pixel in a row came from the same source row, and every pixel in a
    // column from the same source column.
    for (const py of [0, 20, OUT_H - 1]) {
      const row = [0, 15, OUT_W - 1].map((px) => sampledAt(px, py, OUT_W).y);
      for (const y of row) expectNear(y, row[0]);
    }
    for (const px of [0, 15, OUT_W - 1]) {
      const col = [0, 20, OUT_H - 1].map((py) => sampledAt(px, py, OUT_W).x);
      for (const x of col) expectNear(x, col[0]);
    }
  });

  it("survives a degenerate quad without emitting NaN", () => {
    // Four corners dragged onto each other. Nothing sensible to warp, but the
    // capture path must not fill the image with NaN and poison the embedding.
    const point = { x: 60, y: 60 };
    extractCardImage(
      coordinateCanvas(200, 200),
      { topLeft: point, topRight: point, bottomRight: point, bottomLeft: point },
      OUT_W,
    );
    expect(written).not.toBeNull();
    for (const value of written!.data) expect(Number.isFinite(value)).toBe(true);
  });
});

describe("scan corner conversion", () => {
  it("relabels the legacy box card-relative", () => {
    // The camera is mounted sideways, so the card's top edge runs down the raw
    // frame's left side. Getting this round the wrong way would turn every
    // capture 90° and break identification outright.
    const contour = scanCornersToContour(
      cornersFromScanRegion(FRAME.width, FRAME.height, DEFAULT_SCAN_REGION),
      FRAME.width,
      FRAME.height,
    );
    expect(contour.topLeft.x).toBeCloseTo(contour.topRight.x, 6);
    expect(contour.topLeft.y).toBeGreaterThan(contour.topRight.y);
    expect(contour.topLeft.y).toBeCloseTo(contour.bottomLeft.y, 6);
    expect(contour.bottomLeft.x).toBeGreaterThan(contour.topLeft.x);
  });

  it("prefers saved corners over the legacy region", () => {
    const saved = {
      topLeft: { x: 0.1, y: 0.2 },
      topRight: { x: 0.9, y: 0.15 },
      bottomRight: { x: 0.95, y: 0.85 },
      bottomLeft: { x: 0.05, y: 0.8 },
    };
    const resolved = resolveCardContour(
      FRAME.width,
      FRAME.height,
      saved,
      DEFAULT_SCAN_REGION,
    );
    expect(resolved.topLeft).toEqual({ x: 0.1 * FRAME.width, y: 0.2 * FRAME.height });
    expect(resolved).toEqual(
      scanCornersToContour(saved, FRAME.width, FRAME.height),
    );
  });

  it("falls back to the legacy region when no corners are saved", () => {
    expect(
      resolveCardContour(FRAME.width, FRAME.height, null, DEFAULT_SCAN_REGION),
    ).toEqual(
      scanCornersToContour(
        cornersFromScanRegion(FRAME.width, FRAME.height, DEFAULT_SCAN_REGION),
        FRAME.width,
        FRAME.height,
      ),
    );
  });
});
