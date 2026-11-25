/**
 * The design-time sessions of the assistant: what each of its agents asks,
 * and what the person sees while it answers.
 */
export type { AssistantVia } from "./application/run-report";
export type { AssistantReport } from "./domain/session";
export { type Sessions, wireSessions } from "./wire";
