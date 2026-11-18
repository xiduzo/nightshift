/**
 * A suggestion for one field of one node, or of the flow: the session that
 * asks for it (`suggest.ts`), its prompt (`suggestion-prompt.ts`, one task
 * per kind of field), and what the prompt knows of the project
 * (`project-facts.ts`).
 */
export { type SuggestFieldInput, suggestField } from "./suggest";
