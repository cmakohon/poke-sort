export interface ServoCalibration {
  bottomClosed: number;
  bottomOpen: number;
  paddleClosed: number;
  paddleOpen: number;
  pusherLeft: number;
  pusherNeutral: number;
  pusherRight: number;
}

export interface ModuleConfig {
  moduleNumber: 1 | 2 | 3;
  calibration: ServoCalibration;
  /**
   * False when the module has no saved row and `calibration` is
   * DEFAULT_CALIBRATION standing in for one, so callers can tell a real
   * calibration from a placeholder. The calibration screen needs the
   * placeholder to have something to nudge from; the sorter must never be
   * driven to it — see the note on DEFAULT_CALIBRATION below.
   */
  calibrated: boolean;
}

/**
 * Servo positions are PCA9685 pulse counts, NOT degrees.
 *
 * The firmware clamps every write with `constrain(pulse, 120, 490)`
 * (arduino/main/main.ino, setServoPosition), and the calibration UI clamps its
 * nudge buttons to the same pair. Anything outside this range is not a position
 * the hardware can be asked for. The feeder's `speed` goes through the same
 * function, so it shares the range.
 */
export const SERVO_PULSE_MIN = 120;
export const SERVO_PULSE_MAX = 490;

/**
 * Scan region bounds, mirroring clampRegion in scan-region-calibration-panel.
 *
 * The offsets are signed: they move the capture window from the centre of the
 * frame, so a camera mounted slightly high and left needs negatives. A real
 * calibration in the wild reads offsetX -0.05, offsetY -0.06 — an earlier
 * version of the API validation bounded these 0..1 and rejected exactly that.
 */
export const SCAN_COVERAGE_MIN = 0.1;
export const SCAN_COVERAGE_MAX = 1;
export const SCAN_OFFSET_LIMIT = 0.45;
/**
 * Degrees either way. This corrects a camera mounted slightly off square, so
 * the useful range is single digits; the limit is set well past that but short
 * of the point where "rotated" would be better described as a different
 * orientation — a 90° turn is the renderer's job, not the calibration's.
 */
export const SCAN_ROTATION_LIMIT = 45;

/**
 * The starting point the calibration screen offers, NOT a safe set of positions
 * to drive. It spans nearly the whole 120-490 pulse range, so a module whose
 * linkage is calibrated for a narrower one is driven past its hard stop — that
 * detaches servo arms. Only ever push a calibration with `calibrated: true`.
 */
export const DEFAULT_CALIBRATION: ServoCalibration = {
  bottomClosed: 400,
  bottomOpen: 150,
  paddleClosed: 420,
  paddleOpen: 150,
  pusherLeft: 150,
  pusherNeutral: 230,
  pusherRight: 300,
};

export interface FeederCalibration {
  speed: number;
  duration: number;
  pulseDuration: number;
  pauseDuration: number;
  settleDuration: number;
}

export const DEFAULT_FEEDER_CALIBRATION: FeederCalibration = {
  speed: 250,
  duration: 3000,
  pulseDuration: 80,
  pauseDuration: 0,
  settleDuration: 500,
};
