import { DatabaseSync } from "node:sqlite";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { action, createRuntime, s, type Plan } from "../src/index";

type AppContext = {
  db: DatabaseSync;
};

const db = new DatabaseSync(":memory:");

db.exec(`
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    assignee TEXT,
    completed INTEGER NOT NULL DEFAULT 0
  )
`);

const runtime = createRuntime<AppContext>({
  actions: {
    create_task: action({
      description: "Create a task",
      tags: ["tasks", "planning"],
      input: s.object({
        title: s.string().min(1).max(200),
      }),
      output: s.object({
        id: s.string(),
        title: s.string(),
      }),
      requiresApproval: true,
      risk: "low",
      preview: ({ input }) => ({
        title: `Create task: ${input.title}`,
        impact: "Inserts one row into the tasks table",
      }),
      execute: ({ input, ctx }) => {
        const result = ctx.db
          .prepare("INSERT INTO tasks (title) VALUES (?)")
          .run(input.title);

        return {
          id: String(result.lastInsertRowid),
          title: input.title,
        };
      },
    }),

    assign_task: action({
      description: "Assign a task to someone",
      tags: ["tasks", "assignment"],
      input: s.object({
        taskId: s.string(),
        assignee: s.string().min(1).max(100),
      }),
      output: s.object({
        id: s.string(),
        assignee: s.string(),
      }),
      requiresApproval: true,
      risk: "low",
      preview: ({ input }) => ({
        title: `Assign task ${input.taskId} to ${input.assignee}`,
        impact: "Updates one task row",
      }),
      execute: ({ input, ctx }) => {
        ctx.db
          .prepare("UPDATE tasks SET assignee = ? WHERE id = ?")
          .run(input.assignee, input.taskId);

        return {
          id: input.taskId,
          assignee: input.assignee,
        };
      },
    }),

    complete_task: action({
      description: "Mark a task complete",
      tags: ["tasks", "completion"],
      input: s.object({
        taskId: s.string(),
      }),
      output: s.object({
        id: s.string(),
        completed: s.boolean(),
      }),
      requiresApproval: true,
      risk: "low",
      preview: ({ input }) => ({
        title: `Complete task ${input.taskId}`,
        impact: "Marks one task row as completed",
      }),
      execute: ({ input, ctx }) => {
        ctx.db
          .prepare("UPDATE tasks SET completed = 1 WHERE id = ?")
          .run(input.taskId);

        return {
          id: input.taskId,
          completed: true,
        };
      },
    }),
  },
});

async function planWithOpenAI(request: string): Promise<Plan> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Set OPENAI_API_KEY first");

  const manifest = runtime.describe();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: [
            "You convert user requests into agent-conductor plans.",
            "Return only JSON matching the response schema.",
            "Use only the provided action types and input schemas.",
            "Plans are ordered lists, not programs.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            request,
            manifest,
            referenceSyntax: {
              description: "Later steps can reference previous outputs with pure ref objects.",
              example: { $ref: "first_task.output.id" },
            },
          }, null, 2),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "agent_conductor_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["summary", "actions"],
            properties: {
              summary: { type: "string" },
              actions: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "type", "input"],
                  properties: {
                    id: { type: "string" },
                    type: { type: "string" },
                    input: { type: "object" },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no plan content");

  return JSON.parse(content) as Plan;
}

async function main() {
  const request = process.argv.slice(2).join(" ") || "Create a launch checklist with three tasks and assign the first one to Sam";
  const ctx = { db };

  const plan = await planWithOpenAI(request);
  const validation = await runtime.validate(plan, ctx);

  if (!validation.ok) {
    console.error("Invalid plan:", JSON.stringify(validation.errors, null, 2));
    process.exitCode = 1;
    return;
  }

  const preview = await runtime.preview(plan, ctx);
  console.log("\nPlan preview:\n", JSON.stringify(preview, null, 2));

  const rl = createInterface({ input, output });
  const answer = await rl.question("\nExecute this plan? [y/N] ");
  rl.close();

  if (answer.toLowerCase() !== "y") return;

  const result = await runtime.execute(plan, ctx);
  console.log("\nExecution result:\n", JSON.stringify(result, null, 2));

  const rows = ctx.db
    .prepare("SELECT id, title, assignee, completed FROM tasks ORDER BY id")
    .all();

  console.log("\nSQLite rows:\n", JSON.stringify(rows, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
