import type { Place } from "../capabilities";
import { MECHANISM as M } from "./kinds";

/** The verticals of `packages/agents` (`scripts/capabilities.ts` says how to place one). */
export const PACKAGE_AGENTS: Record<string, Place> = {
	assistant: "assistant",
	// Setup constants, default models and the words of a Value refusal.
	decider: "decider",
	// Model-API adapters for Decision and Value nodes (O1, decision 98).
	"decider-providers": M,
	// Is a program on this computer, which version, whose login.
	doctor: M,
	// One adapter and one record of facts per harness, and the skills
	// each harness can run. The skills were a mechanism of their own.
	// They read the skill folders of each harness from its facts and
	// the plugins of Claude Code, so they are rules of a harness.
	harnesses: "agents",
	knowledge: "knowledge",
	// The contract between the engine and a harness or a decider.
	port: M,
	// What a session or a model call cost, from a price list.
	pricing: M,
	// One harness session behind every adapter: the sandbox, the stream,
	// the tool bridge. It runs a session and decides nothing about agents.
	session: M,
	// The MCP client, the help of a CLI program, and a tool spec as a tool
	// a session takes (`asBridgedTools`). The definitions of
	// the tools are `settings` (the Device document of the engine).
	tools: M,
};
