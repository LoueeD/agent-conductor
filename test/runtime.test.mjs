import assert from "node:assert/strict";
import test from "node:test";
import { action, createRuntime, s } from "../dist/index.mjs";

test("runtime searches, validates, previews, and executes plans", async () => {
  const created = [];
  const runtime = createRuntime({
    actions: {
      create_task: action({
        description: "Create a task",
        tags: ["tasks"],
        input: s.object({ name: s.string() }),
        preview: ({ input }) => ({ title: `Create ${input.name}` }),
        execute: async ({ input }) => {
          created.push(input.name);
          return { id: `task_${input.name}` };
        },
      }),
    },
  });

  assert.equal(runtime.search("tasks").actions.length, 1);

  const plan = { summary: "setup", actions: [{ type: "create_task", input: { name: "Write README" } }] };
  assert.equal((await runtime.validate(plan, {})).ok, true);

  const preview = await runtime.preview(plan, {});
  assert.equal(preview.ok, true);
  assert.equal(preview.steps[0].title, "Create Write README");

  const result = await runtime.execute(plan, {});
  assert.equal(result.ok, true);
  assert.deepEqual(created, ["Write README"]);
  assert.deepEqual(result.steps[0].output, { id: "task_Write README" });
});

test("execution resolves previous step output references", async () => {
  const runtime = createRuntime({
    actions: {
      create_task: action({
        description: "Create task",
        input: s.object({ name: s.string() }),
        execute: ({ input }) => ({ id: `task_${input.name}` }),
      }),
      assign_task: action({
        description: "Assign task",
        input: s.object({ taskId: s.string(), assignee: s.string() }),
        execute: ({ input }) => input,
      }),
    },
  });

  const result = await runtime.execute({
    actions: [
      { id: "task", type: "create_task", input: { name: "Write README" } },
      { type: "assign_task", input: { taskId: { $ref: "task.output.id" }, assignee: "Lou" } },
    ],
  }, {});

  assert.equal(result.ok, true);
  assert.equal(result.steps[1].input.taskId, "task_Write README");
});

test("validation returns structured errors", async () => {
  const runtime = createRuntime({
    actions: {
      set_status: action({
        description: "Set status",
        input: s.object({ status: s.enum(["todo", "done"]) }),
        execute: ({ input }) => input,
      }),
    },
  });

  const result = await runtime.validate({ actions: [{ type: "set_status", input: { status: "bad" } }] }, {});
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "INVALID_INPUT");
  assert.equal(result.errors[0].path, "actions.0.input.status");
});
