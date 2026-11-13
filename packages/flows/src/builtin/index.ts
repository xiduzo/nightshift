/** Night Shift's own agents: the six built-in agents, who answers for each, and the places that start one. */

export {
	AGENT_ENTRIES,
	type AgentEntry,
	type AgentEntryId,
	agentEntryIdSchema,
	BUILTIN_AGENTS,
	type BuiltinAgent,
	type BuiltinAgentId,
	type BuiltinAnswer,
	type BuiltinAnswers,
	type BuiltinCheck,
	type BuiltinStatus,
	type BuiltinTakes,
	builtinAgent,
	builtinAgentIdSchema,
	builtinAnswersSchema,
	builtinModel,
	type EntrySaving,
	entryOpening,
	entrySavingSchema,
	type ModelPick,
} from "./builtin";
