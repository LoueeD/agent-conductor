import assert from "node:assert/strict";
import { action, createRuntime, s } from "../dist/index.mjs";

const runtime = createRuntime({
  actions: {
    echo: action({
      description: "Echo a value",
      input: s.object({ value: s.string() }),
      execute: ({ input }) => input,
    }),
  },
});

assert.equal(runtime.search("echo").actions.length, 1);
const result = await runtime.execute({ actions: [{ type: "echo", input: { value: "ok" } }] }, {});
assert.equal(result.ok, true);
assert.deepEqual(result.steps[0]?.output, { value: "ok" });
