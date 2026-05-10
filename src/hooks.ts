import type { Plan, RuntimeError, ValidationResult } from "./types";

export type RuntimeHooks<Ctx> = {
  beforeValidate?: (args: { plan: unknown; ctx: Ctx }) => unknown;
  afterValidate?: (args: { plan: unknown; result: ValidationResult; ctx: Ctx }) => unknown;
  beforeStep?: (args: { step: Plan["actions"][number]; input: unknown; ctx: Ctx }) => unknown;
  afterStep?: (args: { step: Plan["actions"][number]; output: unknown; ctx: Ctx }) => unknown;
  onStepError?: (args: { step: Plan["actions"][number]; error: RuntimeError; ctx: Ctx }) => unknown;
};
