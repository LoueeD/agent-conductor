# agent-conductor

**agent-conductor** is a tiny, dependency-free TypeScript runtime for structured agent actions.

It helps applications expose a small, safe action surface to AI agents: agents can discover capabilities, propose ordered plans, preview impact, and execute approved actions through your trusted backend code.

```txt
Discover capabilities → create plan → validate → preview → execute
```

Instead of giving an agent arbitrary code execution or hundreds of low-level tools, agent-conductor gives it allowlisted actions, schema validation, dry runs, approval-friendly previews, and sequential execution.

---

## What it is

agent-conductor is a **structured action runtime**.

```txt
Agent / MCP client
      ↓
Small tool surface
      ↓
agent-conductor runtime
      ↓
Developer-defined actions
      ↓
Application backend
```

Your app owns the dangerous parts: auth, data access, side effects, billing, logging, and tenant boundaries. agent-conductor owns the middle: discovery, validation, preview, execution, and MCP-compatible tool descriptions.

It is **not**:

- an AI framework
- an MCP framework
- a sandbox
- a database/task system
- an LLM client
- a workflow language

---

## Install

```sh
npm install agent-conductor
```

> This package currently has no runtime dependencies.

---

## Quick start

```ts
import { action, createRuntime, s } from "agent-conductor";

type AppContext = {
  userId: string;
  tasks: {
    createTask(input: {
      title: string;
      priority?: "low" | "normal" | "high";
    }): Promise<{ id: string }>;

    assignTask(input: {
      taskId: string;
      assignee: string;
    }): Promise<{ id: string }>;
  };
};

const runtime = createRuntime<AppContext>({
  actions: {
    create_task: action({
      description: "Create a task",
      tags: ["tasks", "planning"],

      input: s.object({
        title: s.string().min(1).max(200),
        priority: s.enum(["low", "normal", "high"]).optional(),
      }),

      output: s.object({
        id: s.string(),
      }),

      preview: ({ input }) => ({
        title: `Create task "${input.title}"`,
        impact: "Creates one new task",
      }),

      requiresApproval: true,
      risk: "low",

      execute: async ({ input, ctx }) => {
        return ctx.tasks.createTask(input);
      },
    }),

    assign_task: action({
      description: "Assign a task to a teammate",
      tags: ["tasks", "collaboration"],

      input: s.object({
        taskId: s.string(),
        assignee: s.string(),
      }),

      preview: ({ input }) => ({
        title: `Assign task ${input.taskId} to ${input.assignee}`,
        impact: "Updates one task assignment",
      }),

      execute: async ({ input, ctx }) => {
        return ctx.tasks.assignTask(input);
      },
    }),
  },

  limits: {
    maxActions: 50,
  },
});
```

Use it with an ordered plan:

```ts
const plan = {
  summary: "Plan a launch checklist",
  actions: [
    {
      id: "announcement",
      type: "create_task",
      input: {
        title: "Draft launch announcement",
        priority: "high",
      },
    },
    {
      type: "assign_task",
      input: {
        taskId: { $ref: "announcement.output.id" },
        assignee: "Sam",
      },
    },
  ],
};

const validation = await runtime.validate(plan, ctx);
const preview = await runtime.preview(plan, ctx);

// Show preview to a user, then execute after approval.
const result = await runtime.execute(plan, ctx);
```

---

## Example: OpenAI + SQLite

The core runtime does not call an LLM or own your data layer, but it is designed to sit between them.

A typical flow looks like this:

```txt
User request
  ↓
OpenAI generates a JSON plan
  ↓
agent-conductor validates and previews the plan
  ↓
User approves
  ↓
agent-conductor executes allowlisted actions against SQLite
```

See [`examples/openai-sqlite-tasks.ts`](./examples/openai-sqlite-tasks.ts) for a complete example using:

- OpenAI Chat Completions via `fetch`
- built-in `node:sqlite`
- `create_task`, `assign_task`, and `complete_task` actions
- preview-before-execute approval
- step output references like `{ "$ref": "first_task.output.id" }`

Run it with a recent Node version that supports `node:sqlite`:

```sh
OPENAI_API_KEY=sk-... npx tsx examples/openai-sqlite-tasks.ts \
  "Create a launch checklist with three tasks and assign the first one to Sam"
```

> `tsx` is only used to run the TypeScript example directly. It is not required by agent-conductor.

For a smaller Anthropic Claude example, see [`examples/claude-minimal.ts`](./examples/claude-minimal.ts). It exposes one `add_note` action, asks Claude to return a JSON plan, previews it, and executes it:

```sh
ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/claude-minimal.ts \
  "Add a note saying ship the tiny runtime"
```

---

## Runtime API

```ts
runtime.search(query?);
runtime.planSchema();
runtime.describe();
runtime.validate(plan, ctx);
runtime.preview(plan, ctx);
runtime.execute(plan, ctx, options?);
runtime.mcpTools();
runtime.handleToolCall(name, input, ctx);
```

### `search(query?)`

Returns a compact list of available actions. Search is intentionally simple in v1: lowercase matching across action name, description, tags, and input field names.

```ts
runtime.search("tasks");
```

```json
{
  "actions": [
    {
      "type": "create_task",
      "description": "Create a task",
      "tags": ["tasks", "planning"],
      "input": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "priority": {
            "type": "string",
            "enum": ["low", "normal", "high"],
            "optional": true
          }
        },
        "required": ["title"],
        "additionalProperties": false
      },
      "output": {
        "type": "object",
        "properties": {
          "id": { "type": "string" }
        },
        "required": ["id"],
        "additionalProperties": false
      },
      "requiresApproval": true,
      "risk": "low"
    }
  ]
}
```

### `planSchema()`

Returns a compact JSON-schema-like description of the plan envelope, including known action types and their input schemas.

```ts
runtime.planSchema();
```

### `describe()`

Returns a runtime manifest containing action capabilities and the plan schema. This is useful when prompting an LLM to produce valid plans.

```ts
const manifest = runtime.describe();
```

### `validate(plan, ctx)`

Validates plan shape, action count limits, known action types, input schemas, and optional authorization.

Validation failures return structured errors instead of throwing:

```json
{
  "ok": false,
  "errors": [
    {
      "code": "INVALID_INPUT",
      "message": "Expected one of: low, normal, high",
      "path": "actions.0.input.priority",
      "actionIndex": 0,
      "actionType": "create_task"
    }
  ]
}
```

### `preview(plan, ctx)`

Validates the plan and returns approval-friendly preview data. It never executes action handlers.

```json
{
  "ok": true,
  "summary": "Plan a launch checklist",
  "steps": [
    {
      "index": 0,
      "id": "announcement",
      "type": "create_task",
      "title": "Create task \"Draft launch announcement\"",
      "impact": "Creates one new task"
    }
  ],
  "requiresApproval": true,
  "approval": {
    "required": true,
    "stepIndexes": [0],
    "destructive": false,
    "highestRisk": "low"
  }
}
```

### `execute(plan, ctx, options?)`

Revalidates the plan and executes actions sequentially. Execution stops on the first failed action.

```ts
const result = await runtime.execute(plan, ctx, {
  signal,
  dryRun: false,
});
```

The runtime passes an `AbortSignal` to each action. Cancellation is cooperative: handlers should observe the signal for best results. A timeout or external abort makes `execute()` return an aborted/failed result, but JavaScript cannot forcibly stop handler code that ignores the signal, so side effects may still complete in the background.

---

## Actions

An action is the unit of work an agent may request.

```ts
type Action<Input, Output, Context> = {
  description: string;
  tags?: string[];
  input: Schema<Input>;
  output?: Schema<Output>;

  requiresApproval?: boolean;
  destructive?: boolean;
  risk?: "low" | "medium" | "high";

  preview?: (args: {
    input: Input;
    ctx: Context;
  }) => MaybePromise<Preview>;

  execute: (args: {
    input: Input;
    ctx: Context;
    signal?: AbortSignal;
  }) => MaybePromise<Output>;

  authorize?: (args: {
    input: Input;
    ctx: Context;
  }) => MaybePromise<boolean>;

  idempotencyKey?: (args: {
    input: Input;
    ctx: Context;
  }) => string | undefined;
};
```

Required fields:

- `description`
- `input`
- `execute`

Optional fields:

- `tags`
- `output` — validates action outputs and exposes output shape during capability discovery
- `requiresApproval` — defaults to `true`; used by previews and capability descriptions
- `destructive` — marks actions that may delete, overwrite, charge, send, or otherwise cause higher-impact side effects
- `risk` — optional `"low" | "medium" | "high"` metadata for approval UIs
- `preview`
- `authorize`
- `idempotencyKey` — skips duplicate actions with the same key within one execution and reuses the prior output

---

## Plan format

Plans are ordered lists, not programs.

```ts
type Plan = {
  summary?: string;
  actions: PlanStep[];
};

type PlanStep = {
  id?: string;
  type: string;
  input: unknown;
};
```

There is no branching, looping, imports, network access, filesystem access, or generated code execution. Agents compose allowlisted actions; they do not create new execution semantics.

---

## References between steps

Later steps can reference outputs from earlier steps:

```json
{
  "actions": [
    {
      "id": "announcement",
      "type": "create_task",
      "input": {
        "title": "Draft launch announcement"
      }
    },
    {
      "type": "assign_task",
      "input": {
        "taskId": {
          "$ref": "announcement.output.id"
        },
        "assignee": "Sam"
      }
    }
  ]
}
```

Reference rules:

- refs must be pure objects: `{ "$ref": "stepId.output.path" }`
- malformed refs are rejected during validation
- refs can only point to previous steps
- refs can only read from outputs
- refs are resolved before each step executes
- resolved inputs are validated again before execution
- if a referenced step has an `output` schema, ref output paths are checked during validation
- without an `output` schema, unresolved output paths may still fail at execution
- no expressions or string interpolation

---

## Schema builder

agent-conductor includes a small serializable schema builder exposed as `s`.

```ts
const input = s.object({
  title: s.string().min(1).max(200),
  priority: s.enum(["low", "normal", "high"]).optional(),
  labels: s.array(s.string()).max(10).optional(),
});

const parsed = input.parse(value);
const json = input.toJSON();
```

Supported schemas:

- `s.string()` with `.min(length)`, `.max(length)`, `.regex(pattern)`
- `s.number()` with `.min(value)`, `.max(value)`
- `s.int()` with `.min(value)`, `.max(value)`
- `s.boolean()`
- `s.literal(value)`
- `s.enum(values)`
- `s.array(schema)` with `.min(length)`, `.max(length)`
- `s.object(shape)` — rejects unknown properties
- `s.union([...])`
- `s.discriminatedUnion(key, [...])`
- `s.optional(schema)` / `.optional()`
- `s.nullable(schema)` / `.nullable()`
- `s.describe(schema, description)` / `.describe(description)`
- `s.refine(schema, predicate, message)` / `.refine(predicate, message)`
- `s.record(schema)`
- `s.unknown()`

No Zod. No Ajv. No runtime dependencies.

---

## Context boundary

The host application provides context for every operation:

```ts
await runtime.execute(plan, {
  userId,
  orgId,
  tasks,
  permissions,
  logger,
});
```

Actions receive the same context:

```ts
execute: async ({ input, ctx }) => {
  if (!ctx.permissions.canCreateTask) {
    throw new Error("Not allowed");
  }

  return ctx.tasks.createTask(input);
};
```

agent-conductor does not manage auth, storage, tenant isolation, logging, tracing, feature flags, rate limits, or billing. Put those in your context and action handlers.

---

## Hooks

Hooks provide basic observability and integration points without a plugin system. Hook failures are treated as programmer/integration errors and may throw from the runtime method that invoked them.

```ts
const runtime = createRuntime({
  actions,

  hooks: {
    beforeValidate({ plan, ctx }) {},
    afterValidate({ plan, result, ctx }) {},

    beforeStep({ step, input, ctx }) {},
    afterStep({ step, output, ctx }) {},

    onStepError({ step, error, ctx }) {},
  },
});
```

---

## Limits and safety

```ts
const runtime = createRuntime({
  actions,
  limits: {
    maxActions: 50,
    maxInputBytes: 100_000,
    maxOutputBytes: 100_000,
    stepTimeoutMs: 10_000,
  },
});
```

Execution is sequential in v1. Parallelism, transactions, rollback, queues, retries, and branching are intentionally excluded.

---

## MCP-compatible surface

agent-conductor does not depend on the MCP SDK, but it can expose SDK-agnostic tool definitions:

```ts
const tools = runtime.mcpTools();
```

Default tools:

- `search_capabilities`
- `validate_plan`
- `preview_plan`
- `execute_plan`

Dispatch tool calls through:

```ts
const response = await runtime.handleToolCall(name, input, ctx);

// execute_plan also accepts { dryRun: true } in its tool input.
```

A host using an MCP SDK can wire the tools manually:

```ts
for (const tool of runtime.mcpTools()) {
  server.tool(
    tool.name,
    tool.description,
    tool.inputSchema,
    async input => runtime.handleToolCall(tool.name, input, ctx),
  );
}
```

agent-conductor does not know about transports, sessions, clients, stdio, or HTTP.

---

## Error model

Runtime errors are structured:

```ts
type RuntimeError = {
  code:
    | "INVALID_PLAN"
    | "UNKNOWN_ACTION"
    | "UNKNOWN_TOOL"
    | "INVALID_INPUT"
    | "UNAUTHORIZED"
    | "ACTION_FAILED"
    | "LIMIT_EXCEEDED"
    | "ABORTED";

  message: string;
  path?: string;
  actionIndex?: number;
  actionType?: string;
};
```

Normal validation failures return `{ ok: false, errors }`. Programmer errors, such as invalid runtime definitions, may throw.

---

## v1 scope

Included:

- define allowlisted actions
- tiny schema builder
- capability search
- plan validation
- approval-friendly previews
- sequential execution
- simple output references
- MCP-compatible tool definitions
- MCP-compatible tool-call dispatcher
- hooks
- simple limits

Excluded:

- generated code execution
- sandboxing
- LLM calls
- MCP SDK dependency
- full JSON Schema support
- OpenAPI import
- generated UI
- hosted approval flow
- persistence
- queueing
- retries
- transactions
- rollback
- branching and loops
- parallel execution

---

## Development

```sh
npm install
npm run check

# Or run individual checks:
npm run typecheck
npm test
npm run coverage
npm run build
npm run smoke
```

Coverage is configured with Vitest and V8. The goal is 100% coverage for the public v1 surface.

---

## License

MIT
