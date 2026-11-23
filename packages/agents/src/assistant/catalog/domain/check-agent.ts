/** Whether the agent answered, or what stopped it, in words for the person. */
export type AgentCheck = { answered: true } | { answered: false; why: string };
