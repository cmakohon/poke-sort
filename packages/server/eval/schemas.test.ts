/**
 * Every request schema, asserted against values the app actually produces.
 *
 * This exists because three separate bounds shipped wrong, each in the same
 * way: a number was bounded from what its name suggested rather than from a
 * value anyone had looked at. Servo positions were capped at 180 as if they
 * were degrees (they are PCA9685 pulse counts, 120-490). Feeder speed the same.
 * Scan-region offsets were bounded 0..1 as "fractions" when they are signed
 * offsets from the centre of the frame, and a real calibration reads -0.05.
 *
 * All three passed a test at the time, because the tests used invented values.
 * So the rule here is: every case is a constant the app ships, a payload the
 * client is written to send, or a real file — never a number typed to make an
 * assertion go green.
 */
import {
  createDefaultCatchAllOnlyBins,
  DEFAULT_CALIBRATION,
  DEFAULT_FEEDER_CALIBRATION,
  POKEMON_FIELD_DEFINITIONS,
} from "@poke-sort/shared";
import { describe, expect, it } from "vitest";
import { CalibrationDocumentSchema } from "../src/lib/calibration";
import { ClearSchema } from "../src/routes/admin";
import {
  CreateSetSchema,
  RenameSetSchema,
  UpdateBinSchema,
} from "../src/routes/bins";
import {
  AddScanSchema,
  CreateCollectionSchema,
  ScanIdsSchema,
  UpdateScanSchema,
} from "../src/routes/collections";
import { FeederCalibrationSchema } from "../src/routes/feeder";
import { GameInputSchema } from "../src/routes/games";
import { CalibrationSchema } from "../src/routes/module-configs";
import {
  NotificationSettingsSchema,
  SerialEventSchema,
} from "../src/routes/notifications";
import { OrgSettingsSchema } from "../src/routes/org-settings";
import { POKEMON_DEFAULT_URL } from "../src/lib/pokemon/search";

/** Reports the offending field, so a failure says which bound is wrong. */
function accepts(schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown): void {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error?.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Rejected a real value — ${detail}`);
  }
  expect(result.success).toBe(true);
}

/**
 * Recovered from the original mault install. These are the numbers a working
 * machine was actually sorting with, which is the only reason they are here.
 */
const REAL_MACHINE = {
  modules: [
    { moduleNumber: 1 as const, bottomClosed: 420, bottomOpen: 150, paddleClosed: 490, paddleOpen: 150, pusherLeft: 195, pusherNeutral: 305, pusherRight: 380 },
    { moduleNumber: 2 as const, bottomClosed: 400, bottomOpen: 150, paddleClosed: 420, paddleOpen: 150, pusherLeft: 230, pusherNeutral: 310, pusherRight: 420 },
    { moduleNumber: 3 as const, bottomClosed: 400, bottomOpen: 150, paddleClosed: 470, paddleOpen: 130, pusherLeft: 230, pusherNeutral: 310, pusherRight: 400 },
  ],
  feeder: { speed: 250, duration: 3000, pulseDuration: 80, pauseDuration: 0, settleDuration: 500 },
  scanRegion: { coverage: 0.82, offsetX: -0.05, offsetY: -0.06 },
};

describe("calibration bounds", () => {
  it("accepts the shipped servo defaults", () => {
    accepts(CalibrationSchema, DEFAULT_CALIBRATION);
  });

  it("accepts a real machine's servo positions", () => {
    for (const { moduleNumber: _n, ...calibration } of REAL_MACHINE.modules) {
      accepts(CalibrationSchema, calibration);
    }
  });

  it("accepts the extremes the firmware allows", () => {
    // constrain(pulse, 120, 490) — both ends must be storable.
    const at = (v: number) => ({
      bottomClosed: v, bottomOpen: v, paddleClosed: v,
      paddleOpen: v, pusherLeft: v, pusherNeutral: v, pusherRight: v,
    });
    accepts(CalibrationSchema, at(120));
    accepts(CalibrationSchema, at(490));
  });

  it("accepts the shipped and real feeder settings", () => {
    accepts(FeederCalibrationSchema, DEFAULT_FEEDER_CALIBRATION);
    accepts(FeederCalibrationSchema, REAL_MACHINE.feeder);
  });

  it("accepts a signed scan region", () => {
    // The bound that shipped wrong: these offsets are negative in the wild.
    accepts(OrgSettingsSchema, { scanRegion: REAL_MACHINE.scanRegion });
    // clampRegion in the UI permits the full +/-0.45 and coverage down to 0.1.
    accepts(OrgSettingsSchema, { scanRegion: { coverage: 0.1, offsetX: -0.45, offsetY: 0.45 } });
    accepts(OrgSettingsSchema, { scanRegion: { coverage: 1, offsetX: 0, offsetY: 0 } });
  });

  it("accepts the settings payload the old app produced", () => {
    // The full payload this time: captureSettleDelayMs was in the recovered
    // upstream response and had no home here until the delay became a setting.
    accepts(OrgSettingsSchema, {
      primaryColor: null,
      scannerLayout: "horizontal",
      discordWebhookUrl: null,
      discordNotifyOnScan: false,
      scanRegion: REAL_MACHINE.scanRegion,
      captureSettleDelayMs: 500,
    });
  });

  it("accepts a whole real calibration document", () => {
    accepts(CalibrationDocumentSchema, { version: 1, ...REAL_MACHINE });
  });

  it("still accepts a scan region written before rotation existed", () => {
    // REAL_MACHINE.scanRegion has no `rotation`, and every stored region and
    // exported file predating the feature is the same shape. Making rotation
    // required would have rejected all of them.
    accepts(OrgSettingsSchema, { scanRegion: REAL_MACHINE.scanRegion });
    accepts(CalibrationDocumentSchema, { version: 1, ...REAL_MACHINE });
  });

  it("accepts a turned scan region to the limits the UI allows", () => {
    const turned = (rotation: number) => ({ ...REAL_MACHINE.scanRegion, rotation });
    accepts(OrgSettingsSchema, { scanRegion: turned(1.5) });
    accepts(OrgSettingsSchema, { scanRegion: turned(-45) });
    accepts(OrgSettingsSchema, { scanRegion: turned(45) });
    expect(OrgSettingsSchema.safeParse({ scanRegion: turned(45.1) }).success).toBe(false);
    expect(OrgSettingsSchema.safeParse({ scanRegion: turned(-90) }).success).toBe(false);
  });

  it("accepts a four-corner scan region, and rejects one off the frame", () => {
    const quad = {
      topLeft: { x: 0.08, y: 0.21 },
      topRight: { x: 0.91, y: 0.16 },
      bottomRight: { x: 0.94, y: 0.84 },
      bottomLeft: { x: 0.06, y: 0.79 },
    };
    accepts(OrgSettingsSchema, { scanCorners: quad });
    accepts(CalibrationDocumentSchema, { version: 1, ...REAL_MACHINE, scanCorners: quad });
    // Corners are unsigned fractions of the frame, unlike the region's signed
    // offsets — a corner outside the image has nothing to sample.
    expect(
      OrgSettingsSchema.safeParse({
        scanCorners: { ...quad, topLeft: { x: -0.01, y: 0.21 } },
      }).success,
    ).toBe(false);
    // All four are required: three corners do not describe a quadrilateral.
    expect(
      OrgSettingsSchema.safeParse({
        scanCorners: { topLeft: quad.topLeft, topRight: quad.topRight, bottomRight: quad.bottomRight },
      }).success,
    ).toBe(false);
  });

  it("still accepts a document written before corners existed", () => {
    // Same trade as rotation above: scanCorners is optional so that every file
    // already on disk — including calibration/collin-machine.json — imports.
    accepts(CalibrationDocumentSchema, { version: 1, ...REAL_MACHINE });
    accepts(OrgSettingsSchema, { scanRegion: REAL_MACHINE.scanRegion });
  });

});

describe("game and bin bounds", () => {
  it("accepts the Pokemon game exactly as it is seeded", () => {
    // If this fails, boot seeding produces a game its own API would reject.
    accepts(GameInputSchema, {
      key: "pokemon",
      name: "Pokémon",
      dataSourceUrl: POKEMON_DEFAULT_URL,
      fieldDefinitions: POKEMON_FIELD_DEFINITIONS,
    });
  });

  it("accepts the default bin layout the client creates", () => {
    accepts(CreateSetSchema, {
      name: "My Cards",
      initialBins: createDefaultCatchAllOnlyBins(),
    });
  });

  it("accepts a rule tree built from real field definitions", () => {
    const rarity = POKEMON_FIELD_DEFINITIONS.find((f) => f.field === "rarity");
    const price = POKEMON_FIELD_DEFINITIONS.find((f) => f.field === "price_usd");
    expect(rarity?.options?.length).toBeGreaterThan(0);

    accepts(UpdateBinSchema, {
      isCatchAll: false,
      rules: {
        id: crypto.randomUUID(),
        combinator: "and",
        conditions: [
          // enum -> string[] value
          { id: crypto.randomUUID(), field: rarity!.field, operator: "in", value: rarity!.options!.slice(0, 3).map((o) => o.value) },
          // numeric -> number value
          { id: crypto.randomUUID(), field: price!.field, operator: "gt", value: 5 },
          // nested group, which the editor can produce
          {
            id: crypto.randomUUID(),
            combinator: "or",
            conditions: [
              { id: crypto.randomUUID(), field: "types", operator: "contains_any", value: ["Fire", "Water"] },
              { id: crypto.randomUUID(), field: "set_name", operator: "contains", value: "Base" },
            ],
          },
        ],
      },
    });
  });

  it("accepts a set name at the shared maximum", () => {
    accepts(RenameSetSchema, { name: "x".repeat(50) });
  });

  // The panel sends both role flags on every save, and .strict() would have
  // rejected the whole body over the field it had never heard of — which reads
  // in the UI as "saving the bin failed", not "one flag is unknown".
  it("accepts a bin dedicated to review", () => {
    accepts(UpdateBinSchema, {
      isCatchAll: false,
      isReviewBin: true,
      rules: { id: crypto.randomUUID(), combinator: "and", conditions: [] },
    });
  });
});

describe("collection and scan bounds", () => {
  it("accepts the payload the scanner posts for a card", () => {
    accepts(AddScanSchema, {
      scanId: crypto.randomUUID(),
      card: {
        id: "base1-58",
        name: "Pikachu",
        distance: 0.03,
        // The stored upstream object rides along whole.
        set: "base1",
        setName: "Base Set",
        collectorNumber: "58",
        rarity: "common",
        types: ["Lightning"],
        hp: "40",
        price: null,
        raw: { id: "base1-58", localId: "58", hp: 40 },
      },
      scannedAt: new Date().toISOString(),
      binNumber: 3,
      capturedImageUrl: `data:image/jpeg;base64,${"A".repeat(1024)}`,
      isFoil: false,
      alternativeMatches: [{ id: "base1-58_shadowless", name: "Pikachu", distance: 0.04 }],
    });
  });

  it("accepts a correction with its provenance fields", () => {
    accepts(UpdateScanSchema, {
      card: { id: "sv03-125", name: "Charizard ex", distance: 0.11 },
      binNumber: 1,
      isFoil: true,
      variant: "reverse",
      originalCardId: "base1-4",
      originalDistance: 0.09,
      originalScore: 0.61,
      wasCorrected: true,
    });
  });

  it("accepts a bulk selection the size of a real sorting session", () => {
    // "Select all" is unbatched, so this has to clear a whole session.
    accepts(ScanIdsSchema, {
      scanIds: Array.from({ length: 25_000 }, () => crypto.randomUUID()),
    });
  });

  it("accepts a collection created with the seeded game and language", () => {
    accepts(CreateCollectionSchema, {
      name: "My Cards",
      gameGuid: crypto.randomUUID(),
      lang: "en",
    });
  });
});

describe("notification and admin bounds", () => {
  it("accepts every serial event shape the client sends", () => {
    // The five keys reportSerialEvent is written to send, no more.
    accepts(SerialEventSchema, { command: "feeder", sent: false, response: null });
    accepts(SerialEventSchema, { command: "jam", sent: true, response: { error: "jam", module: 2 } });
    accepts(SerialEventSchema, { command: "bin", sent: true, response: { ok: true }, cardName: "Pikachu", binNumber: 7 });
  });

  it("accepts a Discord webhook, and clearing it", () => {
    accepts(NotificationSettingsSchema, {
      discordWebhookUrl: "https://discord.com/api/webhooks/123456789012345678/aBcDeF-gh_1234",
    });
    accepts(NotificationSettingsSchema, { discordWebhookUrl: null });
    accepts(NotificationSettingsSchema, { discordWebhookUrl: "" });
  });

  it("accepts the catalog clear, with and without a game filter", () => {
    accepts(ClearSchema, {});
    accepts(ClearSchema, { gameKey: "pokemon" });
  });
});

describe("bounds still reject what they are meant to", () => {
  it("rejects a servo position the firmware would clamp away", () => {
    expect(CalibrationSchema.safeParse({ ...DEFAULT_CALIBRATION, bottomClosed: 500 }).success).toBe(false);
    expect(CalibrationSchema.safeParse({ ...DEFAULT_CALIBRATION, bottomClosed: 119 }).success).toBe(false);
  });

  it("rejects a scan offset past the UI's own clamp", () => {
    expect(OrgSettingsSchema.safeParse({ scanRegion: { coverage: 0.8, offsetX: -0.9, offsetY: 0 } }).success).toBe(false);
  });

  it("rejects a body trying to pick its own module", () => {
    // The mass-assignment this validation was added for.
    expect(CalibrationSchema.safeParse({ ...DEFAULT_CALIBRATION, moduleNumber: 3 }).success).toBe(false);
  });
});
