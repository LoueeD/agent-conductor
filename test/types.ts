import { action, createRuntime, s, type InferSchema } from "../src/index";

const taskInput = s.object({
  title: s.string().min(1).max(100).regex(/\S/),
  priority: s.enum(["low", "normal", "high"]).optional(),
  labels: s.array(s.string()).min(0).max(3).optional(),
});

type TaskInput = InferSchema<typeof taskInput>;
const validTaskInput: TaskInput = { title: "Ship" };
const validTaskInputWithPriority: TaskInput = { title: "Ship", priority: "high" };
void validTaskInput;
void validTaskInputWithPriority;
// @ts-expect-error title is required
const missingTitle: TaskInput = {};
// @ts-expect-error priority must be one of the enum values
const invalidPriority: TaskInput = { title: "Ship", priority: "urgent" };
void missingTitle;
void invalidPriority;

type AppContext = {
  tasks: {
    create(input: TaskInput): Promise<{ id: string }>;
  };
};

const createTask = action({
  description: "Create task",
  input: taskInput,
  output: s.object({ id: s.string() }),
  execute: async ({ input, ctx }: { input: TaskInput; ctx: AppContext }) => ctx.tasks.create(input),
});

const runtime = createRuntime<AppContext>({
  actions: {
    create_task: createTask,
  },
});

runtime.execute({ actions: [{ type: "create_task", input: { title: "Ship" } }] }, {
  tasks: {
    create: async input => ({ id: input.title }),
  },
});

// @ts-expect-error runtime context must match AppContext
runtime.execute({ actions: [] }, {});
