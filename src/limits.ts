export type RuntimeLimits = {
  maxActions?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  stepTimeoutMs?: number;
};

export const defaultLimits: Required<RuntimeLimits> = {
  maxActions: 50,
  maxInputBytes: 100_000,
  maxOutputBytes: 100_000,
  stepTimeoutMs: 10_000,
};

export function normalizeLimits(overrides: RuntimeLimits = {}): Required<RuntimeLimits> {
  const limits = { ...defaultLimits };
  for (const key of Object.keys(overrides) as Array<keyof RuntimeLimits>) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid runtime limit ${key}: expected a non-negative safe integer`);
    }
    limits[key] = value;
  }
  return limits;
}
