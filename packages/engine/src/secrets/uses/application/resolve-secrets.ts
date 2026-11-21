import type { SecretUse } from "../../../contract";
import {
	type ComputerSecrets,
	type KnownSecrets,
	listPersonalNames,
	type PersonalSecrets,
	type ProjectSecrets,
	type Reach,
	reachPersonal,
	reachProjects,
	type SecretEnvironment,
	type SecretFacts,
	secretScopes,
} from "../../scopes";
import type { Resolved } from "../domain/secret-uses";

export type ResolveSecretsPorts = {
	computer: Pick<ComputerSecrets, "get">;
	facts: Pick<SecretFacts, "saved">;
	personal: Reach<Pick<PersonalSecrets, "list" | "values">>;
	projects: Reach<Pick<ProjectSecrets, "values">>;
	known: KnownSecrets;
	env: SecretEnvironment;
	/** "Be a Host" is on here now: the Secret scope rule reads it. */
	host: () => boolean;
};

/** The names to read, and the facts of their use. */
export type ResolveSecrets = { names: Iterable<string>; use?: SecretUse };

/**
 * The values of `names` for one use, from the scopes the rule gives it
 * (`secretScopes`), the most specific last so that it wins: the
 * environment, this computer's keychain, the run's Space and its
 * Project, then Personal. Not a use: the caller notes the use.
 *
 * Fails closed: when the Project or the Personal secrets cannot be read,
 * a name this computer last knew as one of them has no value, rather than
 * a value of another scope. Other names still read the scopes that
 * answered. The values stay in the answer: none reaches the log.
 */
export const resolveSecrets =
	(ports: ResolveSecretsPorts) =>
	async ({ names, use = {} }: ResolveSecrets): Promise<Resolved> => {
		const { known } = ports;
		const scopes = secretScopes(use, { host: ports.host() });
		const wanted = [...new Set(names)];
		const vars: Record<string, string | undefined> = { ...ports.env };
		const fromProject = new Set<string>();
		for (const name of wanted) {
			if (!ports.facts.saved().has(name)) continue;
			const value = await ports.computer.get(name);
			if (value !== null) vars[name] = value;
		}
		let projectUnreachable = false;
		if (scopes.shared && ports.projects !== undefined && wanted.length > 0) {
			const projectNames = known.projectNamesOf(scopes.shared.projectId);
			try {
				const found = await reachProjects(ports.projects).values(
					scopes.shared,
					wanted,
				);
				for (const name of wanted) {
					const value = found[name];
					if (value === undefined) projectNames.delete(name);
					else {
						vars[name] = value;
						projectNames.add(name);
						fromProject.add(name);
					}
				}
			} catch (error) {
				projectUnreachable = true;
				known.warnOnce("read", error, "Project");
				for (const name of wanted) {
					if (projectNames.has(name)) delete vars[name];
				}
			}
		}
		let unreachable = false;
		let personalHere = false;
		if (
			ports.personal !== undefined &&
			wanted.length > 0 &&
			scopes.personal !== "offer"
		) {
			if (scopes.personal === "host") {
				// The person learns that a Personal name works nowhere here.
				await listPersonalNames(ports);
				personalHere = wanted.some(
					(name) => known.personal.has(name) && vars[name] === undefined,
				);
			} else {
				try {
					const found = await reachPersonal(ports.personal).values(wanted);
					known.answered();
					for (const name of wanted) {
						const value = found[name];
						if (value === undefined) known.personal.delete(name);
						else {
							vars[name] = value;
							fromProject.delete(name);
							if (!known.personal.has(name)) known.personal.set(name, 0);
						}
					}
				} catch (error) {
					unreachable = true;
					known.warnOnce("read", error);
					for (const name of wanted) {
						if (known.personal.has(name)) {
							delete vars[name];
							fromProject.delete(name);
						}
					}
				}
			}
		}
		return { vars, fromProject, unreachable, projectUnreachable, personalHere };
	};
