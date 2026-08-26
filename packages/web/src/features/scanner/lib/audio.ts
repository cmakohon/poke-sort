/**
 * The scanner's sounds.
 *
 * Extracted from use-scanner-engine, which owned the AudioContext privately —
 * a second caller (the value chime, fired from useScannedCards) would
 * otherwise have had to open its own.
 */

// Singleton AudioContext - browsers cap concurrent contexts (~6).
// Creating one per scan exhausts the limit quickly.
let sharedAudioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new AudioContext();
  }
  return sharedAudioCtx;
}

/** Descending two-tone: the scan found nothing. */
export function playDingSound() {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume();

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.connect(gain);
  gain.connect(ctx.destination);

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, ctx.currentTime);
  oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.1);

  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + 0.3);
}

/**
 * Rising arpeggio: a card worth stopping for just landed.
 *
 * Deliberately the opposite shape to playDingSound — rising rather than
 * falling, triangle rather than sine — because the two fire seconds apart
 * during a run and mean opposite things.
 */
export function playValueChime() {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") ctx.resume();

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.connect(gain);
  gain.connect(ctx.destination);

  // E5 - A5 - D6.
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(659.25, ctx.currentTime);
  oscillator.frequency.setValueAtTime(880, ctx.currentTime + 0.08);
  oscillator.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.16);

  gain.gain.setValueAtTime(0.25, ctx.currentTime);
  gain.gain.setValueAtTime(0.25, ctx.currentTime + 0.16);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + 0.35);
}
