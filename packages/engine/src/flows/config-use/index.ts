/**
 * What uses each name of this computer's configuration in the flows of a
 * Space: the "Used by" of the Secrets, Connections, CLI tools and profiles
 * (`wireConfigUse`).
 */

export type { FlowRef } from "./domain/flow-use";
export { type ConfigUse, wireConfigUse } from "./wire";
