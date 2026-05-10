import type { ActionMap } from "./action";
import type { RuntimeHooks } from "./hooks";
import { asAction } from "./internal";
import type { RuntimeLimits } from "./limits";
import { byteSize } from "./plan";
import { resolveRefs, type StepOutput } from "./refs";
import type { ExecuteOptions, ExecuteResult, RuntimeError, StepResult, ValidationResult } from "./types";

type IdempotencyEntry = { index: number; output: unknown };

function abortError(actionIndex?: number, actionType?: string): RuntimeError {
  return { code: "ABORTED", message: "Execution aborted", ...(actionIndex !== undefined ? { actionIndex } : {}), ...(actionType !== undefined ? { actionType } : {}) };
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

export async function executePlan<Ctx>(args: {
  plan: unknown;
  ctx: Ctx;
  actions: ActionMap<Ctx>;
  limits: Required<RuntimeLimits>;
  hooks?: RuntimeHooks<Ctx>;
  options?: ExecuteOptions;
  validate: (plan: unknown, ctx: Ctx) => Promise<ValidationResult>;
}): Promise<ExecuteResult> {
  const { plan, ctx, actions, limits, hooks, options = {}, validate } = args;
  const validated = await validate(plan, ctx);
  if (!validated.ok) return { ok: false, steps: [], errors: validated.errors };
  const results: StepResult[] = [];
  const outputs = new Map<string, StepOutput>();
  const idempotency = new Map<string, IdempotencyEntry>();
  if (options.dryRun) {
    return {
      ok: true,
      ...(validated.plan.summary ? { summary: validated.plan.summary } : {}),
      steps: validated.plan.actions.map((step, index) => ({ index, ...(step.id ? { id: step.id } : {}), type: step.type, status: "skipped", input: step.input })),
    };
  }

  for (const [index, step] of validated.plan.actions.entries()) {
    if (options.signal?.aborted) {
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
      const rawOutput = await runWithAbort(
        signal => Promise.resolve(definition.execute({ input: parsed.value, ctx, signal })),
        limits.stepTimeoutMs,
        options.signal,
      );
      const parsedOutput = definition.output?.parse(rawOutput, `actions.${index}.output`);
      if (parsedOutput && !parsedOutput.ok) {
        const error = { ...parsedOutput.errors[0]!, actionIndex: index, actionType: step.type };
        throw Object.assign(new Error(error.message), { runtimeError: error });
      }
      const output = parsedOutput?.ok ? parsedOutput.value : rawOutput;
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
