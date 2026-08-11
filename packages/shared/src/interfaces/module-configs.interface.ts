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
