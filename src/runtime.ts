import type { ActionMap } from "./action";
import { executePlan } from "./execute";
import type { RuntimeHooks } from "./hooks";
import { normalizeLimits, type RuntimeLimits } from "./limits";
import { describeRuntime, planSchema as createPlanSchema } from "./manifest";
import { mcpTools as createMcpTools, handleMcpToolCall } from "./mcp";
import { previewPlan } from "./preview";
import { searchCapabilities } from "./search";
import type { CapabilitySearchResult, ExecuteOptions, ExecuteResult, PreviewResult, Runtime, ValidationResult } from "./types";
import { validatePlan } from "./validate";

export type { RuntimeHooks } from "./hooks";
export type { RuntimeLimits } from "./limits";

export type CreateRuntimeOptions<Ctx, Actions extends ActionMap<Ctx> = ActionMap<Ctx>> = {
  actions: Actions;
  limits?: RuntimeLimits;
  hooks?: RuntimeHooks<Ctx>;
};

export function createRuntime<Ctx, Actions extends ActionMap<Ctx> = ActionMap<Ctx>>(options: CreateRuntimeOptions<Ctx, Actions>): Runtime<Ctx> {
  const actions = options.actions;
  const limits = normalizeLimits(options.limits);
  const hooks = options.hooks;
  const entries = Object.entries(actions);

  for (const [name, definition] of entries) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`Invalid action name: ${name}`);
    if (!definition?.description || !definition.input || !definition.execute) {
      throw new Error(`Invalid action definition: ${name}`);
    }
  }

  async function validate(plan: unknown, ctx: Ctx): Promise<ValidationResult> {
    return validatePlan({ plan, ctx, actions, limits, ...(hooks ? { hooks } : {}) });
  }

  async function preview(plan: unknown, ctx: Ctx): Promise<PreviewResult> {
    return previewPlan({ plan, ctx, actions, validate });
  }

  async function execute(plan: unknown, ctx: Ctx, executeOptions: ExecuteOptions = {}): Promise<ExecuteResult> {
    return executePlan({ plan, ctx, actions, limits, ...(hooks ? { hooks } : {}), options: executeOptions, validate });
  }

  function search(query = ""): CapabilitySearchResult {
    return searchCapabilities(entries, query);
  }

  function planSchema(): unknown {
    return createPlanSchema(entries);
  }

  function describe() {
    return describeRuntime(entries);
  }

  const core = { search, validate, preview, execute };
  async function handleToolCall(name: string, input: unknown, ctx: Ctx): Promise<unknown> {
    return handleMcpToolCall(core, name, input, ctx);
  }

  return { ...core, planSchema, describe, mcpTools: createMcpTools, handleToolCall } satisfies Runtime<Ctx>;
}
