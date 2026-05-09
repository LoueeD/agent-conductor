export type { Plan, PlanStep } from "./types";

const textEncoder = new TextEncoder();

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function byteSize(value: unknown): number {
  try {
    return textEncoder.encode(JSON.stringify(value)).length;
  } catch {
    return Infinity;
  }
}
