import type { Action } from "./action";
import { isPlainObject } from "./plan";
import type { CapabilitySearchResult } from "./types";

function pathFields(json: unknown): string[] {
  if (!isPlainObject(json)) return [];
  const props = json.properties;
  return isPlainObject(props) ? Object.keys(props) : [];
}

export function searchCapabilities<Ctx>(
  entries: Array<[string, Action<any, any, Ctx>]>,
  query = "",
): CapabilitySearchResult {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const found = entries
    .map(([type, definition]) => {
      const haystack = [type, definition.description, ...(definition.tags ?? []), ...pathFields(definition.input.toJSON())].join(" ").toLowerCase();
      const score = terms.length === 0 ? 1 : terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { type, definition, score };
    })
    .filter(entry => terms.length === 0 || entry.score === terms.length)
    .sort((a, b) => b.score - a.score);

  return {
    actions: found.map(({ type, definition }) => ({
      type,
      description: definition.description,
      ...(definition.tags ? { tags: definition.tags } : {}),
      input: definition.input.toJSON(),
      ...(definition.output ? { output: definition.output.toJSON() } : {}),
      requiresApproval: definition.requiresApproval ?? true,
      ...(definition.destructive !== undefined ? { destructive: definition.destructive } : {}),
      ...(definition.risk ? { risk: definition.risk } : {}),
    })),
  };
}
