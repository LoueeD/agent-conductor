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
