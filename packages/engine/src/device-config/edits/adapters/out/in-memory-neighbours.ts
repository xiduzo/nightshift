import type {
	AgentProfile,
	CustomAgent,
	HarnessName,
	Profile,
} from "@nightshift/flows";
import type { CliTool, CliToolInput } from "../../../cli-tools";
import type { Connection, ConnectionInput } from "../../../connections";
import type {
	EditedCliTools,
	EditedConnections,
	EditedProfiles,
	EditedSettings,
	Programs,
} from "../../application/ports";
import type { ProfileView } from "../../domain/profile-edits";

/** What the settings twin starts with. */
export type SettingsAnswers = {
	harnesses?: HarnessName[];
	customAgents?: CustomAgent[];
	agentPermissionMode?: AgentProfile["permissionMode"];
	bins?: Partial<Record<HarnessName, string>>;
};

/** The settings in memory: what a test sets, and every patch saved. */
export function inMemoryEditedSettings(answers: SettingsAnswers = {}) {
	let values = {
		harnesses: answers.harnesses ?? [],
		customAgents: answers.customAgents ?? [],
		agentPermissionMode: answers.agentPermissionMode ?? "auto",
	};
	const saves: object[] = [];
	const twin = {
		current: () => values,
		async save(patch: {
			harnesses?: HarnessName[];
			customAgents?: CustomAgent[];
		}) {
			saves.push(patch);
			values = { ...values, ...patch };
		},
		/** The program of a harness: the harness's name, unless the test sets one. */
		bin: (harness: HarnessName) => answers.bins?.[harness] ?? harness,
		/** Every patch, in order. */
		saves,
	};
	return twin satisfies EditedSettings;
}

/** The profiles in memory: ids from a counter, in the order of the profiles. */
export function inMemoryEditedProfiles(initial: ProfileView[] = []) {
	const profiles = new Map(initial.map((p) => [p.id, p]));
	let next = 1;
	const list = () =>
		[...profiles.values()].sort(
			(a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
		);
	const twin = {
		get: (id: string) => profiles.get(id) ?? null,
		byName: (name: string) => list().find((p) => p.name === name) ?? null,
		list,
		async save(input: Profile, id?: string) {
			const view = { ...input, id: id ?? `p-${next++}`, updatedAt: 1 };
			profiles.set(view.id, view);
			return view;
		},
	};
	return twin satisfies EditedProfiles;
}

/** The connections in memory, without secrets: no references are read. */
export function inMemoryEditedConnections(names: string[] = []) {
	const connections = new Map<string, Connection>();
	const toConnection = (input: ConnectionInput): Connection => ({
		name: input.name,
		description: input.description || null,
		server: input.server as Connection["server"],
		updatedAt: 1,
		variables: [],
	});
	for (const name of names) {
		connections.set(
			name,
			toConnection({ name, server: { url: "https://mcp.example.com" } }),
		);
	}
	const twin = {
		get: (name: string) => connections.get(name) ?? null,
		async save(input: ConnectionInput) {
			const connection = toConnection(input);
			connections.set(connection.name, connection);
			return connection;
		},
		async remove(name: string) {
			connections.delete(name);
		},
		/** The names saved now. */
		names: () => [...connections.keys()],
	};
	return twin satisfies EditedConnections;
}

/** The CLI tools in memory. */
export function inMemoryEditedCliTools(initial: CliTool[] = []) {
	const tools = new Map(initial.map((t) => [t.name, t]));
	const twin = {
		get: (name: string) => tools.get(name) ?? null,
		list: () => [...tools.values()],
		async save(input: CliToolInput) {
			const tool: CliTool = {
				name: input.name,
				description: input.description || null,
				program: input.program || null,
				login: null,
				git: null,
				updatedAt: 1,
			};
			tools.set(tool.name, tool);
			return tool;
		},
		async remove(name: string) {
			tools.delete(name);
		},
	};
	return twin satisfies EditedCliTools;
}

/** The programs of this computer, in memory: a test names the ones it has. */
export function inMemoryPrograms(found: string[] = []) {
	return {
		where: (program: string) =>
			found.includes(program) ? `/usr/bin/${program}` : null,
	} satisfies Programs;
}
