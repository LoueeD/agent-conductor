export type MaybePromise<T> = T | Promise<T>;

export type Preview = {
  title: string;
  description?: string;
  impact?: string;
  destructive?: boolean;
};

export type Plan = {
  summary?: string;
  actions: PlanStep[];
};

export type PlanStep = {
  id?: string;
  type: string;
  input: unknown;
};

export type RuntimeErrorCode =
  | "INVALID_PLAN"
  | "UNKNOWN_ACTION"
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "ACTION_FAILED"
  | "LIMIT_EXCEEDED"
  | "ABORTED";

export type RuntimeError = {
  code: RuntimeErrorCode;
  message: string;
  path?: string;
  actionIndex?: number;
  actionType?: string;
};

export type ValidationResult =
  | { ok: true; plan: Plan; errors?: never }
  | { ok: false; errors: RuntimeError[]; plan?: never };

export type PreviewStep = Preview & {
  index: number;
  id?: string;
  type: string;
};

export type PreviewResult =
  | { ok: true; summary?: string; steps: PreviewStep[]; requiresApproval: true }
  | { ok: false; errors: RuntimeError[] };

export type StepResult = {
  index: number;
  id?: string;
  type: string;
  status: "success" | "failed" | "skipped";
  input?: unknown;
  output?: unknown;
  error?: RuntimeError;
};

export type ExecuteResult =
  | { ok: true; summary?: string; steps: StepResult[] }
  | { ok: false; summary?: string; steps: StepResult[]; errors: RuntimeError[] };

export type Capability = {
  type: string;
  description: string;
  tags?: string[];
  input: unknown;
};

export type CapabilitySearchResult = {
  actions: Capability[];
};

export type ExecuteOptions = {
  signal?: AbortSignal;
  dryRun?: boolean;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: unknown;
};

export type Runtime<Ctx> = {
  search(query?: string): CapabilitySearchResult;
  validate(plan: unknown, ctx: Ctx): Promise<ValidationResult>;
  preview(plan: unknown, ctx: Ctx): Promise<PreviewResult>;
  execute(plan: unknown, ctx: Ctx, options?: ExecuteOptions): Promise<ExecuteResult>;
  mcpTools(): ToolDefinition[];
  handleToolCall(name: string, input: unknown, ctx: Ctx): Promise<unknown>;
};
