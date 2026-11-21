import type { SecretUse } from "../../../contract";
import {
	type KnownSecrets,
	listPersonalNames,
	type PersonalSecrets,
	type ProjectSecrets,
	type Reach,
	reachProjects,
	type SecretFacts,
	type SecretReferences,
	secretScopes,
} from "../../scopes";
import type { resolveSecrets } from "./resolve-secrets";

export type ListSecretValuesPorts = {
	facts: Pick<SecretFacts, "saved">;
	references: SecretReferences;
	personal: Reach<Pick<PersonalSecrets, "list">>;
	projects: Reach<Pick<ProjectSecrets, "values">>;
	known: KnownSecrets;
	host: () => boolean;
	resolve: ReturnType<typeof resolveSecrets>;
};

/** The facts of the use whose output the values are taken out of. */
export type ListSecretValues = { use?: SecretUse };

/**
 * The values of the saved secrets (the Personal ones when `use` reads
 * them, and every secret of its run's Space and Project) and of the
 * variables the connections reference, to take out of a session's
 * output. Not a use. Values that cannot be read now are left out. They go
 * to the caller only, never to a log.
 */
export const listSecretValues =
	(ports: ListSecretValuesPorts) =>
	async ({ use = {} }: ListSecretValues): Promise<string[]> => {
		const names = new Set(ports.facts.saved().keys());
		for (const name of ports.references.usedBy().keys()) names.add(name);
		// Every Personal value, when the use reads them: not a use of any.
		const scopes = secretScopes(use, { host: ports.host() });
		if (scopes.personal === "read") {
			for (const { name } of (await listPersonalNames(ports)) ?? []) {
				names.add(name);
			}
		}
		// The names in the wider scopes: a Project value of the same name is
		// one more value to take out, read below.
		const { run: _run, ...wider } = use;
		const { vars } = await ports.resolve({ names, use: wider });
		const values = [...names].flatMap((name) =>
			vars[name] ? [vars[name]] : [],
		);
		// Every value of the run's Space and Project.
		if (scopes.shared && ports.projects !== undefined) {
			try {
				values.push(
					...Object.values(
						await reachProjects(ports.projects).values(scopes.shared),
					),
				);
			} catch (error) {
				ports.known.warnOnce("read", error, "Project");
			}
		}
		return [...new Set(values)];
	};
