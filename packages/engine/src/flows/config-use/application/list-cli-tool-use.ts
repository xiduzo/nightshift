import type {
	CliTool,
	CliToolStore,
	ConnectionStore,
	ProfileStore,
} from "../../../settings";
import { type FlowRef, flowUse, readSpaceFlows } from "../domain/flow-use";
import {
	type Asker,
	profilesNaming,
	sharedNames,
} from "../domain/secret-users";
import type { SpaceViews, ToolLogins, ToolSignIns } from "./ports";

export type ListCliToolUsePorts = {
	spaces: SpaceViews;
	connections: Pick<
		ConnectionStore,
		"secrets" | "projectSecrets" | "spaceSecrets"
	>;
	cliTools: Pick<CliToolStore, "list">;
	profiles: Pick<ProfileStore, "list">;
	toolLaunchers: ToolSignIns;
	logins: ToolLogins;
};

/** Where a tool's login finds its secrets. */
export type CliToolLoginState = {
	/** This computer or the Personal secrets have every value: Sign in works here. */
	signsInHere: boolean;
	/** The projects that keep the values it does not have here. */
	projects: {
		projectId: string;
		projectName: string;
		/** When it last signed in for this project. Null: not yet, or it has no sign-in. */
		signedInAt: number | null;
	}[];
	/** The secrets with no value it can use. Empty when one could not be read now. */
	missing: string[];
};

/** A CLI tool, with the flows and the profiles that name it, and when its login last signed in. */
export type CliToolInUse = CliTool & {
	usedBy: FlowRef[];
	profiles: string[];
	signedInAt: number | null;
	/** Null: the tool has no login. */
	loginState: CliToolLoginState | null;
};

/**
 * This computer's CLI tools, with what uses each in the Space of the
 * Person who asks, and where each login finds its secrets: here, or in
 * the projects that keep them.
 */
export const listCliToolUse =
	(ports: ListCliToolUsePorts) =>
	async (request: { at: Asker }): Promise<CliToolInUse[]> => {
		const { at } = request;
		const space = ports.spaces.open(at);
		const use = flowUse(await readSpaceFlows(space));
		const tools = ports.cliTools.list();
		const references = tools.flatMap((tool) =>
			tool.login ? ports.logins.references(tool.login) : [],
		);
		const listed =
			references.length > 0
				? await ports.connections.secrets(references)
				: null;
		const here = new Set(
			(listed?.secrets ?? []).flatMap((secret) =>
				secret.saved || secret.inEnv ? [secret.name] : [],
			),
		);
		const namesOf = sharedNames({
			space: () => ports.connections.spaceSecrets(at.spaceId, at.personId),
			project: (projectId) =>
				ports.connections.projectSecrets(
					{ spaceId: at.spaceId, projectId },
					at.personId,
				),
		});
		const kept =
			references.length > 0
				? await Promise.all(
						(await space.listProjects()).map(async (project) => ({
							project,
							names: await namesOf(project.id),
						})),
					)
				: [];
		const unknown =
			listed?.personal === "unavailable" ||
			kept.some(({ names }) => names === null);

		async function loginStateOf(
			tool: CliTool,
		): Promise<CliToolLoginState | null> {
			if (!tool.login) return null;
			const signs = tool.login.signIn !== undefined;
			const wanted = ports.logins.references(tool.login);
			const notHere = wanted.filter((name) => !here.has(name));
			const projectRows = await Promise.all(
				kept.flatMap(({ project, names }) =>
					names !== null &&
					wanted.some((name) => names.has(name)) &&
					notHere.every((name) => names.has(name))
						? [
								(async () => ({
									projectId: project.id,
									projectName: project.name,
									signedInAt: signs
										? await ports.toolLaunchers.signedInAt(
												tool.name,
												project.id,
											)
										: null,
								}))(),
							]
						: [],
				),
			);
			return {
				signsInHere:
					notHere.length === 0 || (unknown && projectRows.length === 0),
				projects: projectRows,
				missing: !unknown && projectRows.length === 0 ? notHere : [],
			};
		}

		const profiles = ports.profiles.list();
		return Promise.all(
			tools.map(async (tool) => ({
				...tool,
				usedBy: use.clis.get(tool.name) ?? [],
				profiles: profilesNaming(profiles, (p) => p.clis, tool.name),
				signedInAt: tool.login?.signIn
					? await ports.toolLaunchers.signedInAt(tool.name)
					: null,
				loginState: await loginStateOf(tool),
			})),
		);
	};
