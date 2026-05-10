export type MaybePromise<T> = T | Promise<T>;

export type RiskLevel = "low" | "medium" | "high";

export type Preview = {
  title: string;
  description?: string;
  impact?: string;
  destructive?: boolean;
  risk?: RiskLevel;
  requiresApproval?: boolean;
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
  | "UNKNOWN_TOOL"
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

export type PreviewStep = Omit<Preview, "requiresApproval"> & {
  index: number;
  id?: string;
  type: string;
  requiresApproval: boolean;
};

export type ApprovalSummary = {
  required: boolean;
  stepIndexes: number[];
  destructive: boolean;
  highestRisk?: RiskLevel;
};

export type PreviewResult =
  | { ok: true; summary?: string; steps: PreviewStep[]; requiresApproval: boolean; approval: ApprovalSummary }
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
  output?: unknown;
  requiresApproval: boolean;
  destructive?: boolean;
  risk?: RiskLevel;
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

export type RuntimeDescription = {
  actions: Capability[];
  planSchema: unknown;
};

export type Runtime<Ctx> = {
  search(query?: string): CapabilitySearchResult;
  validate(plan: unknown, ctx: Ctx): Promise<ValidationResult>;
  preview(plan: unknown, ctx: Ctx): Promise<PreviewResult>;
  execute(plan: unknown, ctx: Ctx, options?: ExecuteOptions): Promise<ExecuteResult>;
  planSchema(): unknown;
  describe(): RuntimeDescription;
  mcpTools(): ToolDefinition[];
  handleToolCall(name: string, input: unknown, ctx: Ctx): Promise<unknown>;
};
