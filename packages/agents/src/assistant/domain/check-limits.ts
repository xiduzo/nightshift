import type { SessionLimits } from "./session";

/** What the check asks. Any answer in text counts. */
export const CHECK_PROMPT = "Answer with the one word: ready.";

/** The most the check of an agent may use. */
export const CHECK_LIMITS: Required<SessionLimits> = { turns: 2, usd: 0.1 };