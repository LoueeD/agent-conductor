import { action, createRuntime, s, type Plan } from "../src/index";

const notes: string[] = [];

const runtime = createRuntime({
  actions: {
    add_note: action({
      description: "Add a short note to the in-memory notes list",
      input: s.object({
        text: s.string().min(1).max(500).describe("The note text to add"),
      }),
      output: s.object({
        index: s.int().min(0),
        text: s.string(),
      }),
      requiresApproval: false,
      risk: "low",
      preview: ({ input }) => ({
        title: `Add note: ${input.text}`,
      }),
      execute: ({ input }) => {
        notes.push(input.text);
        return { index: notes.length - 1, text: input.text };
      },
    }),
  },
});

async function planWithClaude(request: string): Promise<Plan> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY first");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest",
      max_tokens: 500,
      system: [
        "Convert the user request into an agent-conductor plan.",
        "Return only raw JSON. No markdown. No prose.",
        "Use only the provided action types and input schemas.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            request,
            manifest: runtime.describe(),
            outputShape: {
              summary: "string",
              actions: [{ type: "add_note", input: { text: "string" } }],
            },
          }, null, 2),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find(block => block.type === "text")?.text;
  if (!text) throw new Error("Claude returned no plan text");

  return JSON.parse(text) as Plan;
}

async function main() {
  const request = process.argv.slice(2).join(" ") || "Add a note saying ship the tiny runtime";
  const plan = await planWithClaude(request);

  const preview = await runtime.preview(plan, {});
  console.log("Preview:\n", JSON.stringify(preview, null, 2));

  if (!preview.ok) {
    process.exitCode = 1;
    return;
  }

  const result = await runtime.execute(plan, {});
  console.log("\nResult:\n", JSON.stringify(result, null, 2));
  console.log("\nNotes:\n", JSON.stringify(notes, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
