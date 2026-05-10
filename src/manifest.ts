import type { Action } from "./action";
import type { RuntimeDescription } from "./types";

function genericPlanSchema(actionTypes: string[] = []): Record<string, unknown> {
  const stepTypeSchema = actionTypes.length ? { type: "string", enum: actionTypes } : { type: "string" };
  return {
    type: "object",
    properties: {
      summary: { type: "string" },
      actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", pattern: "^[a-zA-Z0-9_-]+$" },
            type: stepTypeSchema,
            input: {},
          },
          required: ["type", "input"],
          additionalProperties: false,
        },
      },
    },
    required: ["actions"],
    additionalProperties: false,
  };
}

export function planSchema<Ctx>(entries: Array<[string, Action<any, any, Ctx>]>): Record<string, unknown> {
  if (entries.length === 0) return genericPlanSchema();
  return {
    type: "object",
    properties: {
      summary: { type: "string" },
      actions: {
        type: "array",
        items: {
          oneOf: entries.map(([type, definition]) => ({
            type: "object",
            properties: {
              id: { type: "string", pattern: "^[a-zA-Z0-9_-]+$" },
              type: { const: type },
              input: definition.input.toJSON(),
            },
            required: ["type", "input"],
            additionalProperties: false,
          })),
        },
      },
    },
    required: ["actions"],
    additionalProperties: false,
  };
}

export function describeRuntime<Ctx>(entries: Array<[string, Action<any, any, Ctx>]>): RuntimeDescription {
  return {
    actions: entries.map(([type, definition]) => ({
      type,
      description: definition.description,
      ...(definition.tags ? { tags: definition.tags } : {}),
      input: definition.input.toJSON(),
      ...(definition.output ? { output: definition.output.toJSON() } : {}),
      requiresApproval: definition.requiresApproval ?? true,
      ...(definition.destructive !== undefined ? { destructive: definition.destructive } : {}),
      ...(definition.risk ? { risk: definition.risk } : {}),
    })),
    planSchema: planSchema(entries),
  };
}
