import { vi } from "vitest";

/**
 * Runs `fn` with `Date` frozen just after the start of the NEXT fixed rate-limit window, so a test
 * that sends several requests against a per-minute limit can never straddle a window boundary
 * (which resets the counter and makes the expected 429 vanish). Only `Date` is faked: timers and
 * promises, which the Firestore client relies on, keep running for real. Restored in `finally`.
 *
 * Do not use it for tests that verify real tokens or cookies issued by the emulator.
 */
export async function withPinnedRateWindow<T>(fn: () => Promise<T>, windowSec = 60): Promise<T> {
  const windowMs = windowSec * 1000;
  const nextWindowStart = (Math.floor(Date.now() / windowMs) + 1) * windowMs;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(nextWindowStart + 1000);
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}
