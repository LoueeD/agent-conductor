import type { Action } from "./action";

export function asAction<Ctx>(action: Action<any, any, Ctx>): Action<unknown, unknown, Ctx> {
  return action as Action<unknown, unknown, Ctx>;
}
