import type { Schema } from "./schema";
import type { MaybePromise, Preview, RiskLevel } from "./types";

export type Action<Input, Output, Context> = {
  description: string;
  tags?: string[];
  input: Schema<Input>;
  output?: Schema<Output>;
  requiresApproval?: boolean;
  destructive?: boolean;
  risk?: RiskLevel;
  preview?: (args: { input: Input; ctx: Context }) => MaybePromise<Preview>;
  execute: (args: { input: Input; ctx: Context; signal?: AbortSignal }) => MaybePromise<Output>;
  authorize?: (args: { input: Input; ctx: Context }) => MaybePromise<boolean>;
  idempotencyKey?: (args: { input: Input; ctx: Context }) => string | undefined;
};

export function action<Input, Output, Context = unknown>(definition: Action<Input, Output, Context>): Action<Input, Output, Context> {
  return definition;
}

export type ActionMap<Ctx> = Record<string, Action<any, any, Ctx>>;
