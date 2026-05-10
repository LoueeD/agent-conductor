import { isPlainObject } from "./plan";
import { s } from "./schema";
import type { ExecuteOptions, Runtime, ToolDefinition } from "./types";

export function mcpTools(): ToolDefinition[] {
  const planSchema = s.object({ plan: s.unknown(), dryRun: s.boolean().optional() }).toJSON();
  return [
    { name: "search_capabilities", description: "Search available structured actions", inputSchema: s.object({ query: s.string().optional() }).toJSON() },
    { name: "validate_plan", description: "Validate a structured action plan", inputSchema: planSchema },
    { name: "preview_plan", description: "Preview a structured action plan", inputSchema: planSchema },
    { name: "execute_plan", description: "Execute a validated structured action plan", inputSchema: planSchema },
  ];
}

export async function handleMcpToolCall<Ctx>(
  runtime: Pick<Runtime<Ctx>, "search" | "validate" | "preview" | "execute">,
  name: string,
  input: unknown,
  ctx: Ctx,
): Promise<unknown> {
  const data = isPlainObject(input) ? input : {};
  if (name === "search_capabilities") return runtime.search(typeof data.query === "string" ? data.query : "");
  if (name === "validate_plan") return runtime.validate(data.plan, ctx);
  if (name === "preview_plan") return runtime.preview(data.plan, ctx);
  if (name === "execute_plan") {
    const options: ExecuteOptions = { dryRun: data.dryRun === true };
    return runtime.execute(data.plan, ctx, options);
  }
  return { ok: false, errors: [{ code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` }] };
}
