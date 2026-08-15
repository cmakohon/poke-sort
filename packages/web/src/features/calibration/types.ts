import type { ModuleConfig, ServoCalibration } from "@poke-sort/shared";

export interface ModuleConfigsContextValue {
  configs: ModuleConfig[];
  saveConfig: (
    moduleNumber: 1 | 2 | 3,
    calibration: ServoCalibration,
  ) => Promise<void>;
  moveServo: (
    module: 1 | 2 | 3,
    servo: "bottom" | "paddle" | "pusher",
    value: number,
  ) => void;
  /** Re-push the stored calibration to the sorter. Only call while connected. */
  syncToDevice: () => Promise<void>;
}

export interface ServoConfig {
  name: "bottom" | "paddle" | "pusher";
  labelKey: string;
  controlPositions: string[];
  defaultPosition: string;
  calibrationPositions: { labelKey: string; key: keyof ServoCalibration }[];
}

export type SliderKey = `${1 | 2 | 3}:${"bottom" | "paddle" | "pusher"}`;

export type ActivePositions = Record<string, string | null>;
