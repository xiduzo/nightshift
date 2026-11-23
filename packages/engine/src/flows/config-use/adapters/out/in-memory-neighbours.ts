import type { ProjectFlowMap } from "@nightshift/flows";
import type { ProjectSecretName, SecretView } from "../../../../secrets";
import type { CliTool, Connection, ProfileView } from "../../../../settings";
import type {
	ConfiguredCliTools,
	ConfiguredConnections,
	ConfiguredProfiles,
	SpaceViews,
	ThisDevice,
	ToolLogins,
	ToolSignIns,
} from "../../application/ports";
import type { Asker } from "../../domain/secret-users";

/**
 * The in-memory adapters of the ports that another slice or package fills
 * (`@filledBy` in `application/ports.ts`), and `inMemoryConfigUsePorts`,
 * which gives a use-case test every port at once. Test code: production
 * code never imports this file.
 */

export function inMemoryThisDevice(id: string): ThisDevice {
	return { id };
}

/** A project of a Space: its flows, and the secret name of each flow's webhook schedule. */
export type InMemoryProject = {
	id: string;
	name: string;
	flows: ProjectFlowMap;
	webhooks?: Record<string, string>;
};

export type InMemorySpaceViews = SpaceViews & {
	projects: InMemoryProject[];
	/** Every Person who asked, in order. */
	asked: Asker[];
};

export function inMemorySpaceViews(): InMemorySpaceViews {
	const views: InMemorySpaceViews = {
		projects: [],
		asked: [],
		open(at) {
			views.asked.push(at);
			const find = (projectId: string) =>
				views.projects.find((p) => p.id === projectId);
			return {
				listProjects: async () =>
					views.projects.map(({ id, name }) => ({ id, name })),
				listSchedules: async (projectId) => ({
					schedules: Object.entries(find(projectId)?.webhooks ?? {}).map(
						([flow, secret]) => ({
							flow,
							webhook: { secret: `\${${secret}}` },
						}),
					),
				}),
				flows: { map: async (projectId) => find(projectId)?.flows ?? {} },
			};
		},
	};
	return views;
}

/**
 * This computer's connections and the secrets it knows. `saved` are the
 * names saved here. `shared` gives the names of each project's secrets
 * and of the Space's (`space`): an error is what reading them throws.
 */
export type InMemoryConfiguredConnections = ConfiguredConnections & {
	connections: Connection[];
	saved: string[];
	personal: "available" | "unavailable";
	shared: Record<string, string[] | Error>;
};

export function inMemoryConfiguredConnections(): InMemoryConfiguredConnections {
	const sharedOf = async (key: string): Promise<ProjectSecretName[]> => {
		const names = store.shared[key] ?? [];
		if (names instanceof Error) throw names;
		return names.map((name) => ({ name, setAt: 1, setBy: null }));
	};
	const store: InMemoryConfiguredConnections = {
		connections: [],
		saved: [],
		personal: "available",
		shared: {},
		list: () => store.connections,
		async secrets(named = []) {
			const usedBy = new Map<string, string[]>();
			for (const c of store.connections) {
				for (const { name } of c.variables) {
					usedBy.set(name, [...(usedBy.get(name) ?? []), c.name]);
				}
			}
			const names = new Set([...named, ...usedBy.keys(), ...store.saved]);
			const secrets: SecretView[] = [...names].sort().map((name) => ({
				name,
				scope: "computer",
				saved: store.saved.includes(name),
				inEnv: false,
				usedBy: usedBy.get(name) ?? [],
				setAt: null,
				usedAt: null,
			}));
			return { secrets, personal: store.personal };
		},
		projectSecrets: (project) => sharedOf(project.projectId),
		spaceSecrets: () => sharedOf("space"),
	};
	return store;
}

export type InMemoryConfiguredCliTools = ConfiguredCliTools & {
	tools: CliTool[];
};

export function inMemoryConfiguredCliTools(): InMemoryConfiguredCliTools {
	const store: InMemoryConfiguredCliTools = {
		tools: [],
		list: () => store.tools,
	};
	return store;
}

export type InMemoryConfiguredProfiles = ConfiguredProfiles & {
	profiles: ProfileView[];
};

export function inMemoryConfiguredProfiles(): InMemoryConfiguredProfiles {
	const store: InMemoryConfiguredProfiles = {
		profiles: [],
		list: () => store.profiles,
	};
	return store;
}

/** When each tool last signed in, by `<tool>` or `<tool>/<project>`. */
export type InMemoryToolSignIns = ToolSignIns & {
	at: Record<string, number>;
};

export function inMemoryToolSignIns(): InMemoryToolSignIns {
	const signIns: InMemoryToolSignIns = {
		at: {},
		async signedInAt(tool, projectId) {
			return (
				signIns.at[projectId === undefined ? tool : `${tool}/${projectId}`] ??
				null
			);
		},
	};
	return signIns;
}

/** Each `${NAME}` of a login's variables and of its sign-in input, once. */
export function inMemoryToolLogins(): ToolLogins {
	return {
		references(login) {
			const text = [...Object.values(login.env), login.signIn?.input ?? ""];
			const names = text.flatMap((value) =>
				[...value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(
					(match) => match[1] ?? "",
				),
			);
			return [...new Set(names)];
		},
	};
}

/** Every port of `flows/config-use` at once: this computer is the Device `d1`, with nothing configured. */
export function inMemoryConfigUsePorts() {
	return {
		device: inMemoryThisDevice("d1"),
		spaces: inMemorySpaceViews(),
		connections: inMemoryConfiguredConnections(),
		cliTools: inMemoryConfiguredCliTools(),
		profiles: inMemoryConfiguredProfiles(),
		toolLaunchers: inMemoryToolSignIns(),
		logins: inMemoryToolLogins(),
	};
}
