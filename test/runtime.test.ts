import { describe, expect, it, vi } from "vitest";
import { action, createRuntime, s } from "../src/index";
import { byteSize, isPlainObject } from "../src/plan";
import { resolveRefs, validateRefs } from "../src/refs";

describe("schema", () => {
  it("parses primitives, modifiers, descriptions, and json", () => {
    expect(s.string().parse("x")).toEqual({ ok: true, value: "x" });
    expect(s.string().parse(1).ok).toBe(false);
    expect(s.number().parse(1.5)).toEqual({ ok: true, value: 1.5 });
    expect(s.number().parse(Number.NaN).ok).toBe(false);
    expect(s.int().parse(2)).toEqual({ ok: true, value: 2 });
    expect(s.int().parse(2.2).ok).toBe(false);
    expect(s.boolean().parse(false)).toEqual({ ok: true, value: false });
    expect(s.boolean().parse("false").ok).toBe(false);
    expect(s.literal(null).parse(null)).toEqual({ ok: true, value: null });
    expect(s.literal("a").parse("b").ok).toBe(false);
    expect(s.enum(["todo", "done"]).parse("done")).toEqual({ ok: true, value: "done" });
    expect(s.enum(["todo", "done"]).parse("bad").ok).toBe(false);
    expect(s.unknown().parse(undefined)).toEqual({ ok: true, value: undefined });
    expect(s.string().optional().parse(undefined)).toEqual({ ok: true, value: undefined });
    expect(s.string().nullable().parse(null)).toEqual({ ok: true, value: null });
    expect(s.string().nullable().toJSON()).toEqual({ type: "string", nullable: true });
    expect(s.int().toJSON()).toEqual({ type: "integer" });
    expect(s.enum(["todo", "done"]).toJSON()).toEqual({ type: "string", enum: ["todo", "done"] });
    expect(s.string().describe("name").toJSON()).toEqual({ type: "string", description: "name" });
    expect(s.string().min(2).max(4).regex(/^[a-z]+$/).parse("abc")).toEqual({ ok: true, value: "abc" });
    expect(s.string().min(2).parse("a").ok).toBe(false);
    expect(s.string().min(2).parse(1).ok).toBe(false);
    expect(s.string().max(2).parse("abc").ok).toBe(false);
    expect(s.string().max(2).parse(1).ok).toBe(false);
    expect(s.string().regex(/^a+$/).parse("bbb").ok).toBe(false);
    expect(s.string().regex(/^a+$/).parse(1).ok).toBe(false);
    const globalPattern = /^a+$/g;
    globalPattern.lastIndex = 1;
    expect(s.string().regex(globalPattern).parse("aaa")).toEqual({ ok: true, value: "aaa" });
    expect(globalPattern.lastIndex).toBe(1);
    expect(s.string().min(2).max(4).regex(/^[a-z]+$/).toJSON()).toEqual({ type: "string", minLength: 2, maxLength: 4, pattern: "^[a-z]+$" });
    expect(s.number().min(1).max(2).parse(1.5)).toEqual({ ok: true, value: 1.5 });
    expect(s.number().min(1).parse(0).ok).toBe(false);
    expect(s.number().min(1).parse("0").ok).toBe(false);
    expect(s.number().max(2).parse(3).ok).toBe(false);
    expect(s.number().max(2).parse("3").ok).toBe(false);
    expect(s.number().min(1).max(2).toJSON()).toEqual({ type: "number", minimum: 1, maximum: 2 });
    expect(s.int().min(1).max(2).toJSON()).toEqual({ type: "integer", minimum: 1, maximum: 2 });
    expect(s.string().refine(value => value.startsWith("x"), "Must start with x").parse("abc").ok).toBe(false);
    expect(s.string().refine(value => value.startsWith("x"), "Must start with x").toJSON()).toEqual({ type: "string" });
    expect(s.refine(s.string(), value => value.endsWith("z"), "Must end with z").parse("az")).toEqual({ ok: true, value: "az" });
  });

  it("parses arrays, objects, records, unions, and discriminated unions", () => {
    const array = s.array(s.number());
    expect(array.parse([1, 2])).toEqual({ ok: true, value: [1, 2] });
    expect(array.parse("x").ok).toBe(false);
    const badArray = array.parse([1, "x"]);
    expect(badArray.ok).toBe(false);
    if (!badArray.ok) expect(badArray.errors[0]?.path).toBe("1");

    const object = s.object({ required: s.string(), optional: s.number().optional() });
    expect(object.parse({ required: "x", optional: undefined })).toEqual({ ok: true, value: { required: "x" } });
    const extra = object.parse({ required: "x", extra: true });
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.errors[0]?.message).toBe("Unexpected property: extra");
    expect(object.parse(null).ok).toBe(false);
    expect(object.parse([]).ok).toBe(false);
    expect(object.toJSON()).toEqual({
      type: "object",
      properties: { required: { type: "string" }, optional: { type: "number", optional: true } },
      required: ["required"],
      additionalProperties: false,
    });

    const record = s.record(s.boolean());
    expect(record.parse({ a: true })).toEqual({ ok: true, value: { a: true } });
    expect(record.parse(null).ok).toBe(false);
    const badRecord = record.parse({ a: "true" });
    expect(badRecord.ok).toBe(false);
    if (!badRecord.ok) expect(badRecord.errors[0]?.path).toBe("a");

    expect(s.union([s.string(), s.number()]).parse(1)).toEqual({ ok: true, value: 1 });
    expect(s.union([s.string(), s.number()]).parse(false).ok).toBe(false);
    const du = s.discriminatedUnion("kind", [
      s.object({ kind: s.literal("a"), a: s.string() }),
      s.object({ kind: s.literal("b"), b: s.number() }),
    ]);
    expect(du.parse({ kind: "b", b: 1 })).toEqual({ ok: true, value: { kind: "b", b: 1 } });
    expect(du.parse(null).ok).toBe(false);
    expect(du.parse({ kind: "c" }).ok).toBe(false);
    expect(du.toJSON()).toEqual({ oneOf: [
      { type: "object", properties: { kind: { const: "a" }, a: { type: "string" } }, required: ["kind", "a"], additionalProperties: false },
      { type: "object", properties: { kind: { const: "b" }, b: { type: "number" } }, required: ["kind", "b"], additionalProperties: false },
    ], discriminator: { propertyName: "kind" } });
    expect(s.union([s.string(), s.number()]).toJSON()).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
    expect(s.array(s.string()).toJSON()).toEqual({ type: "array", items: { type: "string" } });
    expect(s.array(s.string()).min(1).max(2).parse(["a"])).toEqual({ ok: true, value: ["a"] });
    expect(s.array(s.string()).min(1).parse([]).ok).toBe(false);
    expect(s.array(s.string()).min(1).parse("no").ok).toBe(false);
    expect(s.array(s.string()).max(1).parse(["a", "b"]).ok).toBe(false);
    expect(s.array(s.string()).max(1).parse("no").ok).toBe(false);
    expect(s.array(s.string()).min(1).max(2).toJSON()).toEqual({ type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 });
    expect(s.record(s.string()).toJSON()).toEqual({ type: "object", additionalProperties: { type: "string" } });
    expect(s.unknown().toJSON()).toEqual({});
    expect(s.optional(s.string()).parse(undefined).ok).toBe(true);
    expect(s.nullable(s.string()).parse(null).ok).toBe(true);
    expect(s.describe(s.string(), "desc").toJSON()).toEqual({ type: "string", description: "desc" });
  });
});

describe("plan helpers and action", () => {
  it("detects plain objects and byte sizes", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
    expect(byteSize({ a: "é" })).toBeGreaterThan(0);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(byteSize(circular)).toBe(Infinity);
  });

  it("returns the action definition", () => {
    const def = action({ description: "x", input: s.unknown(), execute: ({ input }) => input });
    expect(action(def)).toBe(def);
  });
});

describe("runtime", () => {
  it("searches, validates, previews, and executes plans", async () => {
    const created: string[] = [];
    const runtime = createRuntime({
      actions: {
        create_task: action({
          description: "Create a task",
          tags: ["tasks"],
          input: s.object({ name: s.string().describe("Task name") }),
          output: s.object({ id: s.string() }),
          requiresApproval: false,
          risk: "low",
          preview: ({ input }) => ({ title: `Create ${input.name}` }),
          execute: async ({ input }) => {
            created.push(input.name);
            return { id: `task_${input.name}` };
          },
        }),
      },
    });

    createRuntime({ actions: {
      a: action({ description: "common alpha", input: s.unknown(), execute: () => undefined }),
      b: action({ description: "common beta", input: s.unknown(), execute: () => undefined }),
    } }).search("common");
    const mixedApprovalRuntime = createRuntime({ actions: {
      low: action({ description: "low", input: s.unknown(), risk: "low", execute: () => undefined }),
      high: action({ description: "high", input: s.unknown(), risk: "high", execute: () => undefined }),
    } });
    const mixedPreview = await mixedApprovalRuntime.preview({ actions: [{ type: "low", input: null }, { type: "high", input: null }] }, {});
    expect(mixedPreview.ok).toBe(true);
    if (mixedPreview.ok) expect(mixedPreview.approval.highestRisk).toBe("high");
    expect(runtime.search("tasks name").actions).toHaveLength(1);
    expect(runtime.search("missing").actions).toHaveLength(0);
    expect(runtime.search().actions[0]?.input).toEqual({ type: "object", properties: { name: { type: "string", description: "Task name" } }, required: ["name"], additionalProperties: false });
    expect(runtime.search().actions[0]?.output).toEqual({ type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false });
    expect(runtime.search().actions[0]?.requiresApproval).toBe(false);
    expect(runtime.search().actions[0]?.risk).toBe("low");

    const plan = { summary: "setup", actions: [{ type: "create_task", input: { name: "Write README" } }] };
    expect((await runtime.validate(plan, {})).ok).toBe(true);

    const preview = await runtime.preview(plan, {});
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.steps[0]?.title).toBe("Create Write README");
      expect(preview.steps[0]?.requiresApproval).toBe(false);
      expect(preview.requiresApproval).toBe(false);
      expect(preview.approval).toEqual({ required: false, stepIndexes: [], destructive: false, highestRisk: "low" });
    }

    expect((runtime.planSchema() as any).properties.actions.items.oneOf[0].properties.type.const).toBe("create_task");
    expect((runtime.planSchema() as any).properties.actions.items.oneOf[0].properties.input.properties.name.description).toBe("Task name");
    expect(runtime.describe().actions[0]?.type).toBe("create_task");
    expect(runtime.describe().actions[0]?.requiresApproval).toBe(false);
    expect(createRuntime({ actions: {} }).planSchema()).toMatchObject({ properties: { actions: { items: { properties: { type: { type: "string" } } } } } });

    const result = await runtime.execute(plan, {});
    expect(result.ok).toBe(true);
    expect(created).toEqual(["Write README"]);
    expect(result.steps[0]?.output).toEqual({ id: "task_Write README" });
  });

  it("throws for invalid runtime definitions", () => {
    expect(() => createRuntime({ actions: { "bad name": action({ description: "x", input: s.unknown(), execute: () => undefined }) } })).toThrow("Invalid action name");
    expect(() => createRuntime({ actions: { bad: { description: "", input: s.unknown(), execute: () => undefined } as any } })).toThrow("Invalid action definition");
  });

  it("returns structured validation errors", async () => {
    const runtime = createRuntime({ actions: { set_status: action({ description: "Set status", input: s.object({ status: s.enum(["todo", "done"]) }), execute: ({ input }) => input }) } });
    const cases = [
      [null, "Plan must be an object", ""],
      [{ summary: 1, actions: [] }, "summary must be a string", "summary"],
      [{}, "actions must be an array", "actions"],
      [{ actions: [{}] }, "Action type must be a string", "actions.0.type"],
      [{ actions: [null] }, "Action step must be an object", "actions.0"],
      [{ actions: [{ type: "missing", input: {} }] }, "Unknown action: missing", "actions.0.type"],
      [{ actions: [{ id: 1, type: "set_status", input: { status: "todo" } }] }, "Action id must be a string", "actions.0.id"],
      [{ actions: [{ id: "bad id", type: "set_status", input: { status: "todo" } }] }, "Action id must contain", "actions.0.id"],
      [{ actions: [{ id: "x", type: "set_status", input: { status: "todo" } }, { id: "x", type: "set_status", input: { status: "todo" } }] }, "Duplicate action id: x", "actions.1.id"],
      [{ actions: [{ type: "set_status", input: { status: "bad" } }] }, "Expected one of", "actions.0.input.status"],
    ] as const;
    for (const [plan, message, path] of cases) {
      const result = await runtime.validate(plan, {});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.message).toContain(message);
        expect(result.errors[0]?.path).toBe(path);
      }
    }
    const validated = await runtime.validate({ summary: "ok", actions: [{ id: "a", type: "set_status", input: { status: "todo" } }] }, {});
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.plan.summary).toBe("ok");
  });

  it("enforces limits and authorization", async () => {
    const runtime = createRuntime({
      limits: { maxActions: 1, maxInputBytes: 100, maxOutputBytes: 10 },
      actions: {
        auth: action({ description: "auth", input: s.object({ allowed: s.boolean() }), authorize: ({ input }) => input.allowed, execute: () => ({ large: "xxxxxxxxxx" }) }),
      },
    });
    expect((await runtime.validate({ actions: [{ type: "auth", input: { allowed: true } }, { type: "auth", input: { allowed: true } }] }, {})).ok).toBe(false);
    expect((await runtime.validate({ actions: [{ type: "auth", input: { allowed: false } }] }, {})).ok).toBe(false);
    const inputLimited = createRuntime({ limits: { maxInputBytes: 10 }, actions: { auth: action({ description: "auth", input: s.unknown(), execute: () => undefined }) } });
    expect((await inputLimited.validate({ actions: [{ type: "auth", input: { allowed: true, extra: "too long" } }] }, {})).ok).toBe(false);
    const result = await runtime.execute({ actions: [{ type: "auth", input: { allowed: true } }] }, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain("Output exceeds");
  });

  it("validates and resolves reference helpers", () => {
    expect(validateRefs({ value: { $ref: 1 } }, new Set(["task"]))).toMatchObject([{ code: "INVALID_INPUT" }]);
    expect(validateRefs({ value: { $ref: "task.output.id" } }, new Set(["task"]))).toEqual([]);
    const outputSchemas = new Map([["task", { type: "object", properties: { id: { type: "string" }, items: { type: "array", items: { type: "object", properties: { name: { type: "string" } } } } } }]]);
    expect(validateRefs({ value: { $ref: "task.output.id" } }, new Set(["task"]), "input", 0, "x", outputSchemas)).toEqual([]);
    expect(validateRefs({ value: { $ref: "task.output.items.0.name" } }, new Set(["task"]), "input", 0, "x", outputSchemas)).toEqual([]);
    const recordSchemas = new Map([["task", { type: "object", additionalProperties: { type: "object", properties: { name: { type: "string" } } } }]]);
    expect(validateRefs({ value: { $ref: "task.output.anything.name" } }, new Set(["task"]), "input", 0, "x", recordSchemas)).toEqual([]);
    expect(validateRefs({ value: { $ref: "task.output.missing" } }, new Set(["task"]), "input", 0, "x", outputSchemas)).toMatchObject([{ code: "INVALID_INPUT" }]);
    expect(validateRefs({ value: { $ref: "task.output.id" } }, new Set(["task"]), "input", 0, "x", new Map([["task", { type: "string" }]]))).toMatchObject([{ code: "INVALID_INPUT" }]);
    expect(resolveRefs({ $ref: "task.output" }, new Map([["task", { index: 0, output: { id: "task_1" } }]]), 1)).toEqual({ ok: true, value: { id: "task_1" } });
    expect(resolveRefs({ $ref: "task.output.missing" }, new Map([["task", { index: 0, output: { id: "task_1" } }]]), 1).ok).toBe(false);
    expect(resolveRefs({ $ref: "task.output.id" }, new Map([["task", { index: 1, output: { id: "task_1" } }]]), 1).ok).toBe(false);
    expect(resolveRefs([{ $ref: "task.output.missing" }], new Map([["task", { index: 0, output: { id: "task_1" } }]]), 1).ok).toBe(false);
    expect(resolveRefs({ id: { $ref: "task.output.missing" } }, new Map([["task", { index: 0, output: { id: "task_1" } }]]), 1).ok).toBe(false);
  });

  it("resolves references and rejects bad references", async () => {
    const runtime = createRuntime({
      actions: {
        create_task: action({ description: "Create task", input: s.object({ name: s.string() }), output: s.object({ id: s.string() }), execute: ({ input }) => ({ id: `task_${input.name}` }) }),
        assign_task: action({ description: "Assign task", input: s.object({ taskId: s.string(), assignee: s.string() }), preview: ({ input }) => ({ title: input.taskId }), execute: ({ input }) => input }),
        many: action({ description: "Many", input: s.object({ ids: s.array(s.string()) }), execute: ({ input }) => input }),
      },
    });
    const result = await runtime.execute({ actions: [{ id: "task", type: "create_task", input: { name: "Write README" } }, { type: "assign_task", input: { taskId: { $ref: "task.output.id" }, assignee: "Lou" } }] }, {});
    expect(result.ok).toBe(true);
    expect(result.steps[1]?.input).toEqual({ taskId: "task_Write README", assignee: "Lou" });

    const preview = await runtime.preview({ actions: [{ id: "task", type: "create_task", input: { name: "A" } }, { type: "assign_task", input: { taskId: { $ref: "task.output.id" }, assignee: "Lou" } }] }, {});
    expect(preview.ok).toBe(true);
    if (preview.ok) expect(preview.steps[1]?.impact).toContain("references resolve");

    for (const ref of ["missing.output.id", "task.input.id", ".output.id"]) {
      const badValidation = await runtime.validate({ actions: [{ id: "task", type: "create_task", input: { name: "A" } }, { type: "assign_task", input: { taskId: { $ref: ref }, assignee: "Lou" } }] }, {});
      expect(badValidation.ok).toBe(false);
    }

    const forwardRef = await runtime.validate({ actions: [{ type: "assign_task", input: { taskId: { $ref: "task.output.id" }, assignee: "Lou" } }, { id: "task", type: "create_task", input: { name: "A" } }] }, {});
    expect(forwardRef.ok).toBe(false);
    const impureRef = await runtime.validate({ actions: [{ id: "task", type: "create_task", input: { name: "A" } }, { type: "assign_task", input: { taskId: { $ref: "task.output.id", extra: true }, assignee: "Lou" } }] }, {});
    expect(impureRef.ok).toBe(false);

    for (const ref of ["task.output.missing", "task.output.id.part"]) {
      const bad = await runtime.validate({ actions: [{ id: "task", type: "create_task", input: { name: "A" } }, { type: "assign_task", input: { taskId: { $ref: ref }, assignee: "Lou" } }] }, {});
      expect(bad.ok).toBe(false);
    }

    const arrayResolved = await runtime.execute({ actions: [{ id: "task", type: "create_task", input: { name: "A" } }, { type: "many", input: { ids: [{ $ref: "task.output.id" }] } }] }, {});
    expect(arrayResolved.ok).toBe(true);

    const invalidAfterResolve = await runtime.execute({ actions: [{ id: "task", type: "create_task", input: { name: "A" } }, { type: "assign_task", input: { taskId: { $ref: "task.output" }, assignee: "Lou" } }] }, {});
    expect(invalidAfterResolve.ok).toBe(false);
  });

  it("supports dryRun, hooks, idempotency, abort, timeout, external abort, and action errors", async () => {
    const events: string[] = [];
    let count = 0;
    const runtime = createRuntime({
      limits: { stepTimeoutMs: 5 },
      hooks: {
        beforeValidate: () => events.push("beforeValidate"),
        afterValidate: () => events.push("afterValidate"),
        beforeStep: () => events.push("beforeStep"),
        afterStep: () => events.push("afterStep"),
        onStepError: () => events.push("onStepError"),
      },
      actions: {
        ok: action({ description: "ok", input: s.object({ x: s.string() }), idempotencyKey: ({ input }) => input.x, execute: ({ input, signal }) => ({ x: input.x, hasSignal: !!signal, count: ++count }) }),
        fail: action({ description: "fail", input: s.unknown(), execute: () => { throw new Error("boom"); } }),
        bad: action({ description: "bad", input: s.object({ x: s.string() }), execute: () => undefined }),
        denied: action({ description: "denied", input: s.object({ x: s.string() }), authorize: () => false, execute: () => undefined }),
        wait: action({ description: "wait", input: s.unknown(), execute: () => new Promise(resolve => setTimeout(resolve, 50)) }),
        bad_output: action({ description: "bad output", input: s.unknown(), output: s.object({ ok: s.boolean() }), execute: () => ({ ok: "no" }) as any }),
      },
    });

    const dry = await runtime.execute({ actions: [{ type: "ok", input: { x: "a" } }] }, {}, { dryRun: true });
    expect(dry.ok).toBe(true);
    expect(dry.steps[0]?.status).toBe("skipped");

    const idem = await runtime.execute({ actions: [{ id: "a", type: "ok", input: { x: "same" } }, { id: "b", type: "ok", input: { x: "same" } }] }, {});
    expect(idem.ok).toBe(true);
    expect(idem.steps.map(step => step.status)).toEqual(["success", "skipped"]);
    expect(count).toBe(1);
    expect(events).toContain("beforeStep");
    expect(events).toContain("afterStep");

    const failed = await runtime.execute({ actions: [{ type: "fail", input: null }] }, {});
    expect(failed.ok).toBe(false);
    expect(events).toContain("onStepError");

    const badOutput = await runtime.execute({ actions: [{ type: "bad_output", input: null }] }, {});
    expect(badOutput.ok).toBe(false);
    if (!badOutput.ok) expect(badOutput.errors[0]?.path).toBe("actions.0.output.ok");

    const controller = new AbortController();
    controller.abort();
    const aborted = await runtime.execute({ actions: [{ type: "ok", input: { x: "b" } }] }, {}, { signal: controller.signal });
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) expect(aborted.errors[0]?.code).toBe("ABORTED");

    const badParsed = await runtime.execute({ actions: [{ id: "a", type: "ok", input: { x: "a" } }, { type: "bad", input: { x: { $ref: "a.output" } } }] }, {});
    expect(badParsed.ok).toBe(false);

    const denied = await runtime.execute({ actions: [{ id: "a", type: "ok", input: { x: "a" } }, { type: "denied", input: { x: { $ref: "a.output.x" } } }] }, {});
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.errors[0]?.code).toBe("UNAUTHORIZED");

    const timedOut = await runtime.execute({ actions: [{ type: "wait", input: null }] }, {});
    expect(timedOut.ok).toBe(false);
    if (!timedOut.ok) expect(timedOut.errors[0]?.message).toBe("Step timed out");

    const runtimeNoTimeout = createRuntime({ limits: { stepTimeoutMs: 0 }, actions: { ok: action({ description: "ok", input: s.unknown(), execute: () => "ok" }) } });
    expect((await runtimeNoTimeout.execute({ actions: [{ type: "ok", input: null }] }, {})).ok).toBe(true);

    const ext = new AbortController();
    const externalRuntime = createRuntime({ limits: { stepTimeoutMs: 0 }, actions: { wait: action({ description: "wait", input: s.unknown(), execute: () => new Promise(resolve => setTimeout(resolve, 50)) }) } });
    const promise = externalRuntime.execute({ actions: [{ type: "wait", input: null }] }, {}, { signal: ext.signal });
    ext.abort();
    const externalAborted = await promise;
    expect(externalAborted.ok).toBe(false);
    if (!externalAborted.ok) expect(externalAborted.errors[0]?.code).toBe("ABORTED");
  });

  it("exposes MCP-compatible tools and dispatcher", async () => {
    const runtime = createRuntime({ actions: { echo: action({ description: "Echo", input: s.object({ value: s.string() }), destructive: true, risk: "medium", execute: ({ input }) => input }) } });
    expect(runtime.mcpTools().map(tool => tool.name)).toEqual(["search_capabilities", "validate_plan", "preview_plan", "execute_plan"]);
    expect(await runtime.handleToolCall("search_capabilities", { query: "echo" }, {})).toEqual(runtime.search("echo"));
    expect(runtime.search("echo").actions[0]).toMatchObject({ destructive: true, risk: "medium", requiresApproval: true });
    const approvalPreview = await runtime.preview({ actions: [{ type: "echo", input: { value: "x" } }] }, {});
    expect(approvalPreview.ok).toBe(true);
    if (approvalPreview.ok) expect(approvalPreview.approval).toEqual({ required: true, stepIndexes: [0], destructive: true, highestRisk: "medium" });
    expect((await runtime.handleToolCall("validate_plan", { plan: { actions: [] } }, {}) as any).ok).toBe(true);
    expect((await runtime.handleToolCall("preview_plan", { plan: { actions: [] } }, {}) as any).ok).toBe(true);
    expect((await runtime.handleToolCall("execute_plan", { plan: { actions: [{ type: "echo", input: { value: "x" } }] }, dryRun: true }, {}) as any).steps[0].status).toBe("skipped");
    const unknownTool = await runtime.handleToolCall("unknown", null, {}) as any;
    expect(unknownTool.ok).toBe(false);
    expect(unknownTool.errors[0].code).toBe("UNKNOWN_TOOL");
  });
});
