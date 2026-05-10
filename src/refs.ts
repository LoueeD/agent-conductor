import { isPlainObject } from "./plan";
import type { RuntimeError } from "./types";

export type StepOutput = { index: number; output: unknown };

export function isRef(value: unknown): value is { $ref: string } {
  return isPlainObject(value) && Object.keys(value).length === 1 && typeof value.$ref === "string";
}

export function hasRef(value: unknown): boolean {
  if (isRef(value)) return true;
  if (Array.isArray(value)) return value.some(hasRef);
  if (isPlainObject(value)) return Object.values(value).some(hasRef);
  return false;
}

function refError(message: string, path: string, actionIndex?: number, actionType?: string): RuntimeError {
  return {
    code: "INVALID_INPUT",
    message,
    path,
    ...(actionIndex !== undefined ? { actionIndex } : {}),
    ...(actionType !== undefined ? { actionType } : {}),
  };
}

function schemaHasPath(schema: unknown, path: string[]): boolean {
  let current = schema;
  for (const part of path) {
    if (!isPlainObject(current)) return false;
    if (isPlainObject(current.properties)) {
      if (!(part in current.properties)) return false;
      current = current.properties[part];
      continue;
    }
    if (current.type === "array" && /^\d+$/.test(part)) {
      current = current.items;
      continue;
    }
    if (isPlainObject(current.additionalProperties)) {
      current = current.additionalProperties;
      continue;
    }
    return false;
  }
  return true;
}

export function validateRefs(
  value: unknown,
  previousStepIds: ReadonlySet<string>,
  path = "input",
  actionIndex?: number,
  actionType?: string,
  outputSchemas?: ReadonlyMap<string, unknown>,
): RuntimeError[] {
  const errors: RuntimeError[] = [];

  function visit(entry: unknown, entryPath: string) {
    if (isPlainObject(entry) && "$ref" in entry) {
      const keys = Object.keys(entry);
      if (keys.length !== 1 || typeof entry.$ref !== "string") {
        errors.push(refError("Reference must be a pure object: { \"$ref\": string }", entryPath, actionIndex, actionType));
        return;
      }

      const [stepId, scope] = entry.$ref.split(".");
      if (!stepId || scope !== "output") {
        errors.push(refError(`Malformed reference: ${entry.$ref}`, entryPath, actionIndex, actionType));
        return;
      }
      if (!previousStepIds.has(stepId)) {
        errors.push(refError(`Reference must point to a previous step output: ${entry.$ref}`, entryPath, actionIndex, actionType));
        return;
      }
      const outputSchema = outputSchemas?.get(stepId);
      const outputPath = entry.$ref.split(".").slice(2);
      if (outputSchema && !schemaHasPath(outputSchema, outputPath)) {
        errors.push(refError(`Reference path is not described by output schema: ${entry.$ref}`, entryPath, actionIndex, actionType));
      }
      return;
    }

    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${entryPath}.${index}`));
      return;
    }

    if (isPlainObject(entry)) {
      for (const [key, item] of Object.entries(entry)) visit(item, `${entryPath}.${key}`);
    }
  }

  visit(value, path);
  return errors;
}

function getPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const part of path) {
    if (!isPlainObject(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function resolveRefs(
  value: unknown,
  outputs: Map<string, StepOutput>,
  currentIndex: number,
  path = "input",
): { ok: true; value: unknown } | { ok: false; error: RuntimeError } {
  if (isRef(value)) {
    const [stepId, scope, ...parts] = value.$ref.split(".");
    const step = stepId ? outputs.get(stepId) : undefined;
    if (!step || scope !== "output" || step.index >= currentIndex) {
      return { ok: false, error: { code: "INVALID_INPUT", message: `Unresolved reference: ${value.$ref}`, path } };
    }
    const resolved = getPath(step.output, parts);
    if (resolved === undefined) {
      return { ok: false, error: { code: "INVALID_INPUT", message: `Unresolved reference: ${value.$ref}`, path } };
    }
    return { ok: true, value: resolved };
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const [index, entry] of value.entries()) {
      const resolved = resolveRefs(entry, outputs, currentIndex, `${path}.${index}`);
      if (!resolved.ok) return resolved;
      out.push(resolved.value);
    }
    return { ok: true, value: out };
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const resolved = resolveRefs(entry, outputs, currentIndex, `${path}.${key}`);
      if (!resolved.ok) return resolved;
      out[key] = resolved.value;
    }
    return { ok: true, value: out };
  }
  return { ok: true, value };
}
