import type { ActionMap } from "./action";
import type { RuntimeHooks } from "./hooks";
import { asAction } from "./internal";
import type { RuntimeLimits } from "./limits";
import { byteSize, isPlainObject } from "./plan";
import { hasRef, validateRefs } from "./refs";
import type { Plan, RuntimeError, ValidationResult } from "./types";

const runtimeError = (error: RuntimeError): RuntimeError => error;
const invalidPlan = (message: string, path?: string): RuntimeError => runtimeError({ code: "INVALID_PLAN", message, ...(path !== undefined ? { path } : {}) });

export async function validatePlan<Ctx>(args: {
  plan: unknown;
  ctx: Ctx;
  actions: ActionMap<Ctx>;
  limits: Required<RuntimeLimits>;
  hooks?: RuntimeHooks<Ctx>;
}): Promise<ValidationResult> {
  const { plan, ctx, actions, limits, hooks } = args;
  await hooks?.beforeValidate?.({ plan, ctx });
  const errors: RuntimeError[] = [];

  if (!isPlainObject(plan)) errors.push(invalidPlan("Plan must be an object", ""));
  if (errors.length) {
    const result: ValidationResult = { ok: false, errors };
    await hooks?.afterValidate?.({ plan, result, ctx });
    return result;
  }

  const raw = plan as Record<string, unknown>;
  if (raw.summary !== undefined && typeof raw.summary !== "string") {
    errors.push(invalidPlan("summary must be a string", "summary"));
  }
  if (!Array.isArray(raw.actions)) {
    errors.push(invalidPlan("actions must be an array", "actions"));
  } else if (raw.actions.length > limits.maxActions) {
    errors.push({ code: "LIMIT_EXCEEDED", message: `Plan has more than ${limits.maxActions} actions`, path: "actions" });
  }

  if (errors.length) {
    const result: ValidationResult = { ok: false, errors };
    await hooks?.afterValidate?.({ plan, result, ctx });
    return result;
  }

  const parsedActions: Plan["actions"] = [];
  const stepIds = new Set<string>();
  const previousStepIds = new Set<string>();
  const previousOutputSchemas = new Map<string, unknown>();
  for (const [index, rawStep] of (raw.actions as unknown[]).entries()) {
    if (!isPlainObject(rawStep)) {
      errors.push(invalidPlan("Action step must be an object", `actions.${index}`));
      continue;
    }
    const type = rawStep.type;
    if (typeof type !== "string") {
      errors.push(invalidPlan("Action type must be a string", `actions.${index}.type`));
      continue;
    }
    const id = rawStep.id;
    if (id !== undefined && typeof id !== "string") {
      errors.push(invalidPlan("Action id must be a string", `actions.${index}.id`));
      continue;
    }
    if (typeof id === "string") {
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        errors.push(invalidPlan("Action id must contain only letters, numbers, underscores, and hyphens", `actions.${index}.id`));
        continue;
      }
      if (stepIds.has(id)) {
        errors.push(invalidPlan(`Duplicate action id: ${id}`, `actions.${index}.id`));
        continue;
      }
      stepIds.add(id);
    }
    const definition = actions[type];
    if (!definition) {
      errors.push({ code: "UNKNOWN_ACTION", message: `Unknown action: ${type}`, path: `actions.${index}.type`, actionIndex: index, actionType: type });
      continue;
    }
    if (byteSize(rawStep.input) > limits.maxInputBytes) {
      errors.push({ code: "LIMIT_EXCEEDED", message: `Input exceeds ${limits.maxInputBytes} bytes`, path: `actions.${index}.input`, actionIndex: index, actionType: type });
      continue;
    }
    const refErrors = validateRefs(rawStep.input, previousStepIds, `actions.${index}.input`, index, type, previousOutputSchemas);
    if (refErrors.length) {
      errors.push(...refErrors);
      continue;
    }
    const inputHasRefs = hasRef(rawStep.input);
    const parsed = inputHasRefs ? { ok: true as const, value: rawStep.input } : asAction(definition).input.parse(rawStep.input, `actions.${index}.input`);
    if (!parsed.ok) {
      errors.push(...parsed.errors.map(error => ({ ...error, actionIndex: index, actionType: type })));
      continue;
    }
    if (definition.authorize && !inputHasRefs) {
      const authorized = await asAction(definition).authorize?.({ input: parsed.value, ctx });
      if (!authorized) {
        errors.push({ code: "UNAUTHORIZED", message: `Unauthorized action: ${type}`, path: `actions.${index}`, actionIndex: index, actionType: type });
        continue;
      }
    }
    parsedActions.push({
      ...(typeof id === "string" ? { id } : {}),
      type,
      input: parsed.value,
    });
    if (typeof id === "string") {
      previousStepIds.add(id);
      if (definition.output) previousOutputSchemas.set(id, definition.output.toJSON());
    }
  }

  const result: ValidationResult = errors.length ? { ok: false, errors } : { ok: true, plan: { ...(typeof raw.summary === "string" ? { summary: raw.summary } : {}), actions: parsedActions } };
  await hooks?.afterValidate?.({ plan, result, ctx });
  return result;
}
