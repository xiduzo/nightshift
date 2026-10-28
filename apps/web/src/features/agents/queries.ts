/**
 * The query and mutation options of the agents: Agent Profiles, harnesses,
 * Connections and their Secrets, CLI Tools and deciders.
 */

import type {
	AgentProfileRow,
	CheckTarget,
	HarnessRowName,
	ModelProfileRow,
	ProfileRow,
} from "@/shared/api";
import { orpc } from "@/shared/api";

export const profileQueries = {
	/** Every profiles query. Invalidate it after a profile, a Connection or a CLI Tool changes. */
	all: () => orpc.profiles.key(),
	/** Every list of profiles. */
	lists: () => orpc.profiles.list.key(),
	/** The profiles of this computer: Agent Profiles and Model Profiles. */
	list: () => orpc.profiles.list.queryOptions(),
	/** The Agent Profiles of this computer, for Agent nodes and the assistant. */
	agents: () => ({
		...orpc.profiles.list.queryOptions(),
		select: (rows: ProfileRow[]) =>
			rows.filter((p): p is AgentProfileRow => "harness" in p),
	}),
	/** The Model Profiles of this computer, for Decisions and Values decided by a model. */
	models: () => ({
		...orpc.profiles.list.queryOptions(),
		select: (rows: ProfileRow[]) =>
			rows.filter((p): p is ModelProfileRow => "decider" in p),
	}),
	/** A project's own profiles, and whether this computer overrides each. */
	project: (projectId: string) =>
		orpc.profiles.project.queryOptions({ input: { projectId } }),
};

export const profileMutations = {
	save: orpc.profiles.save.mutationOptions,
	remove: orpc.profiles.remove.mutationOptions,
};

export const harnessQueries = {
	/** Every harnesses query. Invalidate it after a harness is added or removed. */
	all: () => orpc.harnesses.key(),
	/** Every list of harnesses. */
	lists: () => orpc.harnesses.list.key(),
	/** The harnesses of this computer, with their state and Custom Agents. */
	list: () => orpc.harnesses.list.queryOptions(),
	/** The models a harness offers. */
	models: (harness: HarnessRowName) =>
		orpc.harnesses.models.queryOptions({ input: { harness } }),
	/** The skills a harness finds for a project. */
	skills: (harness: HarnessRowName, projectId: string) =>
		orpc.harnesses.skills.queryOptions({ input: { harness, projectId } }),
};

export const harnessMutations = {
	add: orpc.harnesses.add.mutationOptions,
	remove: orpc.harnesses.remove.mutationOptions,
	saveCustom: orpc.harnesses.saveCustom.mutationOptions,
};

export const connectionQueries = {
	/** Every list of Connections. */
	lists: () => orpc.connections.list.key(),
	/** The Connections (MCP servers) of this computer. */
	list: () => orpc.connections.list.queryOptions(),
	/** Every check of a program or a harness login. */
	checks: () => orpc.connections.check.key(),
	/** Whether a program or a harness login is ready. */
	check: (target: CheckTarget) =>
		orpc.connections.check.queryOptions({ input: { target } }),
	/** The tools of one Connection. */
	tools: (name: string) =>
		orpc.connections.tools.queryOptions({ input: { name } }),
};

export const connectionMutations = {
	save: orpc.connections.save.mutationOptions,
	remove: orpc.connections.remove.mutationOptions,
	test: orpc.connections.test.mutationOptions,
	setSecret: orpc.connections.setSecret.mutationOptions,
	removeSecret: orpc.connections.removeSecret.mutationOptions,
};

export const cliToolQueries = {
	/** Every list of CLI Tools. */
	lists: () => orpc.cliTools.list.key(),
	/** The CLI Tools of this computer. */
	list: () => orpc.cliTools.list.queryOptions(),
	/** Whether this computer finds a CLI Tool. */
	check: (name: string) =>
		orpc.cliTools.check.queryOptions({ input: { name } }),
	/** The programs this computer finds, to pick a new CLI Tool from. */
	programs: () => orpc.cliTools.programs.queryOptions(),
};

export const cliToolMutations = {
	save: orpc.cliTools.save.mutationOptions,
	remove: orpc.cliTools.remove.mutationOptions,
	signIn: orpc.cliTools.signIn.mutationOptions,
};

export const otherDeviceQueries = {
	/** The owner's other Devices: their profiles and secret names, read-only here. */
	list: () => orpc.devices.others.queryOptions(),
};

export const deciderQueries = {
	/** The deciders of this computer: who decides a Decision node, and whether its key is set. */
	list: () => orpc.deciders.list.queryOptions(),
};
