/** The uses of the secrets: Night Shift reads values for one use, by the Secret scope rule, and notes the use. `wireUses` binds the use cases to the ports of the scopes. */

export type { ExpandedEnv } from "./application/expand-secret-references";
export { notRead } from "./domain/secret-uses";
export { type Uses, wireUses } from "./wire";
