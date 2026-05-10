import type { ActionMap } from "./action";
import { asAction } from "./internal";
import { hasRef } from "./refs";
import type { PreviewResult, RiskLevel, ValidationResult } from "./types";

const riskRank: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };

function higherRisk(a: RiskLevel | undefined, b: RiskLevel | undefined): RiskLevel | undefined {
  if (!a) return b;
  if (!b) return a;
  return riskRank[b] > riskRank[a] ? b : a;
}

export async function previewPlan<Ctx>(args: {
  plan: unknown;
  ctx: Ctx;
  actions: ActionMap<Ctx>;
  validate: (plan: unknown, ctx: Ctx) => Promise<ValidationResult>;
}): Promise<PreviewResult> {
  const { plan, ctx, actions, validate } = args;
  const validated = await validate(plan, ctx);
  if (!validated.ok) return { ok: false, errors: validated.errors };
  const steps = [];
  for (const [index, step] of validated.plan.actions.entries()) {
    const definition = asAction(actions[step.type]!);
    const inputHasRefs = hasRef(step.input);
    const p = definition.preview && !inputHasRefs
      ? await definition.preview({ input: step.input, ctx })
      : { title: step.type, impact: inputHasRefs ? `Runs ${step.type}; references resolve at execution` : `Runs ${step.type}` };
    steps.push({
      index,
      ...(step.id ? { id: step.id } : {}),
      type: step.type,
      requiresApproval: definition.requiresApproval ?? true,
      ...(definition.destructive !== undefined ? { destructive: definition.destructive } : {}),
      ...(definition.risk ? { risk: definition.risk } : {}),
      ...p,
    });
  }
  const approvalSteps = steps.filter(step => step.requiresApproval !== false);
  const highestRisk = steps.reduce<RiskLevel | undefined>((risk, step) => higherRisk(risk, step.risk), undefined);
  return {
    ok: true,
    ...(validated.plan.summary ? { summary: validated.plan.summary } : {}),
    steps,
    requiresApproval: approvalSteps.length > 0,
    approval: {
      required: approvalSteps.length > 0,
      stepIndexes: approvalSteps.map(step => step.index),
      destructive: steps.some(step => step.destructive === true),
      ...(highestRisk ? { highestRisk } : {}),
    },
  };
}
