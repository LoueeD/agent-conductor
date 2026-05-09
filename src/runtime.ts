import type { Action, ActionMap } from "./action";
import { byteSize, isPlainObject } from "./plan";
import { s } from "./schema";
import type {
  CapabilitySearchResult,
  ExecuteOptions,
  ExecuteResult,
  Plan,
  PreviewResult,
  Runtime,
  RuntimeError,
  StepResult,
  ToolDefinition,
  ValidationResult,
} from "./types";

export type RuntimeLimits = {
  maxActions?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  stepTimeoutMs?: number;
};

export type RuntimeHooks<Ctx> = {
  beforeValidate?: (args: { plan: unknown; ctx: Ctx }) => unknown;
  afterValidate?: (args: { plan: unknown; result: ValidationResult; ctx: Ctx }) => unknown;
  beforeStep?: (args: { step: Plan["actions"][number]; input: unknown; ctx: Ctx }) => unknown;
  afterStep?: (args: { step: Plan["actions"][number]; output: unknown; ctx: Ctx }) => unknown;
  onStepError?: (args: { step: Plan["actions"][number]; error: RuntimeError; ctx: Ctx }) => unknown;
};

export type CreateRuntimeOptions<Ctx, Actions extends ActionMap<Ctx>> = {
  actions: Actions;
  limits?: RuntimeLimits;
  hooks?: RuntimeHooks<Ctx>;
};

const defaultLimits: Required<RuntimeLimits> = {
  maxActions: 50,
  maxInputBytes: 100_000,
  maxOutputBytes: 100_000,
  stepTimeoutMs: 10_000,
};

const runtimeError = (error: RuntimeError): RuntimeError => error;
const invalidPlan = (message: string, path?: string): RuntimeError => runtimeError({ code: "INVALID_PLAN", message, ...(path !== undefined ? { path } : {}) });

function pathFields(json: unknown): string[] {
  if (!isPlainObject(json)) return [];
  const props = json.properties;
  return isPlainObject(props) ? Object.keys(props) : [];
}

function asAction<Ctx>(action: Action<any, any, Ctx>): Action<unknown, unknown, Ctx> {
  return action as Action<unknown, unknown, Ctx>;
}

function abortError(actionIndex?: number, actionType?: string): RuntimeError {
  return { code: "ABORTED", message: "Execution aborted", ...(actionIndex !== undefined ? { actionIndex } : {}), ...(actionType !== undefined ? { actionType } : {}) };
}

type StepOutput = { index: number; output: unknown };
type IdempotencyEntry = { index: number; output: unknown };

function isRef(value: unknown): value is { $ref: string } {
  return isPlainObject(value) && Object.keys(value).length === 1 && typeof value.$ref === "string";
}

function hasRef(value: unknown): boolean {
  if (isRef(value)) return true;
  if (Array.isArray(value)) return value.some(hasRef);
  if (isPlainObject(value)) return Object.values(value).some(hasRef);
  return false;
}

function getPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const part of path) {
    if (!isPlainObject(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveRefs(value: unknown, outputs: Map<string, StepOutput>, currentIndex: number, path = "input"): { ok: true; value: unknown } | { ok: false; error: RuntimeError } {
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

async function runWithAbort<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  if (external?.aborted) throw new Error("Aborted");
  external?.addEventListener("abort", abort, { once: true });
  if (timeoutMs > 0) timeout = setTimeout(() => controller.abort(), timeoutMs);

  let abortReject: ((reason: Error) => void) | undefined;
  const onAbort = () => abortReject?.(new Error(external?.aborted ? "Aborted" : "Step timed out"));
  controller.signal.addEventListener("abort", onAbort, { once: true });

  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<T>((_, reject) => {
        abortReject = reject;
      }),
    ]);
  } finally {
    abortReject = undefined;
    controller.signal.removeEventListener("abort", onAbort);
    if (timeout) clearTimeout(timeout);
    external?.removeEventListener("abort", abort);
  }
}

export function createRuntime<Ctx, Actions extends ActionMap<Ctx>>(options: CreateRuntimeOptions<Ctx, Actions>): Runtime<Ctx> {
  const actions = options.actions;
  const limits = { ...defaultLimits, ...options.limits };
  const hooks = options.hooks;
  const entries = Object.entries(actions);

  for (const [name, definition] of entries) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid action name: ${name}`);
    if (!definition?.description || !definition.input || !definition.execute) {
      throw new Error(`Invalid action definition: ${name}`);
    }
  }

  async function validate(plan: unknown, ctx: Ctx): Promise<ValidationResult> {
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
    }

    const result: ValidationResult = errors.length ? { ok: false, errors } : { ok: true, plan: { ...(typeof raw.summary === "string" ? { summary: raw.summary } : {}), actions: parsedActions } };
    await hooks?.afterValidate?.({ plan, result, ctx });
    return result;
  }

  async function preview(plan: unknown, ctx: Ctx): Promise<PreviewResult> {
    const validated = await validate(plan, ctx);
    if (!validated.ok) return { ok: false, errors: validated.errors };
    const steps = [];
    for (const [index, step] of validated.plan.actions.entries()) {
      const definition = asAction(actions[step.type]!);
      const inputHasRefs = hasRef(step.input);
      const p = definition.preview && !inputHasRefs
        ? await definition.preview({ input: step.input, ctx })
        : { title: step.type, impact: inputHasRefs ? `Runs ${step.type}; references resolve at execution` : `Runs ${step.type}` };
      steps.push({ index, ...(step.id ? { id: step.id } : {}), type: step.type, ...p });
    }
    return { ok: true, ...(validated.plan.summary ? { summary: validated.plan.summary } : {}), steps, requiresApproval: true };
  }

  async function execute(plan: unknown, ctx: Ctx, executeOptions: ExecuteOptions = {}): Promise<ExecuteResult> {
    const validated = await validate(plan, ctx);
    if (!validated.ok) return { ok: false, steps: [], errors: validated.errors };
    const results: StepResult[] = [];
    const outputs = new Map<string, StepOutput>();
    const idempotency = new Map<string, IdempotencyEntry>();
    if (executeOptions.dryRun) {
      return {
        ok: true,
        ...(validated.plan.summary ? { summary: validated.plan.summary } : {}),
        steps: validated.plan.actions.map((step, index) => ({ index, ...(step.id ? { id: step.id } : {}), type: step.type, status: "skipped", input: step.input })),
      };
    }

    for (const [index, step] of validated.plan.actions.entries()) {
      if (executeOptions.signal?.aborted) {
        const error = abortError(index, step.type);
        results.push({ index, ...(step.id ? { id: step.id } : {}), type: step.type, status: "failed", input: step.input, error });
        return { ok: false, ...(validated.plan.summary ? { summary: validated.plan.summary } : {}), steps: results, errors: [error] };
      }
      const definition = asAction(actions[step.type]!);
      try {
        const resolved = resolveRefs(step.input, outputs, index, `actions.${index}.input`);
        if (!resolved.ok) throw Object.assign(new Error(resolved.error.message), { runtimeError: resolved.error });
        const parsed = definition.input.parse(resolved.value, `actions.${index}.input`);
        if (!parsed.ok) {
          const error = { ...parsed.errors[0]!, actionIndex: index, actionType: step.type };
          throw Object.assign(new Error(error.message), { runtimeError: error });
        }
        if (definition.authorize) {
          const authorized = await definition.authorize({ input: parsed.value, ctx });
          if (!authorized) {
            const error: RuntimeError = { code: "UNAUTHORIZED", message: `Unauthorized action: ${step.type}`, path: `actions.${index}`, actionIndex: index, actionType: step.type };
            throw Object.assign(new Error(error.message), { runtimeError: error });
          }
        }
        const idempotencyKey = definition.idempotencyKey?.({ input: parsed.value, ctx });
        if (idempotencyKey) {
          const prior = idempotency.get(idempotencyKey);
          if (prior) {
            if (step.id) outputs.set(step.id, { index, output: prior.output });
            results.push({ index, ...(step.id ? { id: step.id } : {}), type: step.type, status: "skipped", input: parsed.value, output: prior.output });
            continue;
          }
        }
        const runStep = { ...step, input: parsed.value };
        await hooks?.beforeStep?.({ step: runStep, input: parsed.value, ctx });
        const output = await runWithAbort(
          signal => Promise.resolve(definition.execute({ input: parsed.value, ctx, signal })),
          limits.stepTimeoutMs,
          executeOptions.signal,
        );
        if (byteSize(output) > limits.maxOutputBytes) {
          throw new Error(`Output exceeds ${limits.maxOutputBytes} bytes`);
        }
        await hooks?.afterStep?.({ step: runStep, output, ctx });
        if (idempotencyKey) idempotency.set(idempotencyKey, { index, output });
        if (step.id) outputs.set(step.id, { index, output });
        results.push({ index, ...(step.id ? { id: step.id } : {}), type: step.type, status: "success", input: parsed.value, output });
      } catch (cause) {
        const runtime = cause && typeof cause === "object" && "runtimeError" in cause ? (cause.runtimeError as RuntimeError) : undefined;
        const message = cause instanceof Error ? cause.message : String(cause);
        const error: RuntimeError = runtime ?? { code: message === "Aborted" ? "ABORTED" : "ACTION_FAILED", message, actionIndex: index, actionType: step.type };
        await hooks?.onStepError?.({ step, error, ctx });
        results.push({ index, ...(step.id ? { id: step.id } : {}), type: step.type, status: "failed", input: step.input, error });
        return { ok: false, ...(validated.plan.summary ? { summary: validated.plan.summary } : {}), steps: results, errors: [error] };
      }
    }
    return { ok: true, ...(validated.plan.summary ? { summary: validated.plan.summary } : {}), steps: results };
  }

  function search(query = ""): CapabilitySearchResult {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const found = entries
      .map(([type, definition]) => {
        const haystack = [type, definition.description, ...(definition.tags ?? []), ...pathFields(definition.input.toJSON())].join(" ").toLowerCase();
        const score = terms.length === 0 ? 1 : terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
        return { type, definition, score };
      })
      .filter(entry => terms.length === 0 || entry.score === terms.length)
      .sort((a, b) => b.score - a.score);
    return {
      actions: found.map(({ type, definition }) => ({
        type,
        description: definition.description,
        ...(definition.tags ? { tags: definition.tags } : {}),
        input: definition.input.toJSON(),
      })),
    };
  }

  function mcpTools(): ToolDefinition[] {
    const planSchema = s.object({ plan: s.unknown(), dryRun: s.boolean().optional() }).toJSON();
    return [
      { name: "search_capabilities", description: "Search available structured actions", inputSchema: s.object({ query: s.string().optional() }).toJSON() },
      { name: "validate_plan", description: "Validate a structured action plan", inputSchema: planSchema },
      { name: "preview_plan", description: "Preview a structured action plan", inputSchema: planSchema },
      { name: "execute_plan", description: "Execute a validated structured action plan", inputSchema: planSchema },
    ];
  }

  async function handleToolCall(name: string, input: unknown, ctx: Ctx): Promise<unknown> {
    const data = isPlainObject(input) ? input : {};
    if (name === "search_capabilities") return search(typeof data.query === "string" ? data.query : "");
    if (name === "validate_plan") return validate(data.plan, ctx);
    if (name === "preview_plan") return preview(data.plan, ctx);
    if (name === "execute_plan") return execute(data.plan, ctx, { dryRun: data.dryRun === true });
    return { ok: false, errors: [{ code: "UNKNOWN_ACTION", message: `Unknown tool: ${name}` }] };
  }

  return { search, validate, preview, execute, mcpTools, handleToolCall };
}
