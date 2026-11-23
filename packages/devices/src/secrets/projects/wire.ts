import type { ProjectSecrets } from "@nightshift/engine/device-config";
import type { Caller, ProjectSecretName } from "../../contract";
import type { HostCalls } from "../calls";
import type { ProjectSecretStore, SpaceSecretStore } from "../kept";
import { PERSONAL_DEADLINE_MS } from "../personal";
import { listKeptProjectSecrets } from "./application/list-kept-project-secrets";
import { listKeptSpaceSecrets } from "./application/list-kept-space-secrets";
import { listKeptValues } from "./application/list-kept-values";
import { listProjectSecrets } from "./application/list-project-secrets";
import { listSpaceSecrets } from "./application/list-space-secrets";
import type {
	EnginePlaces,
	KeeperSpaces,
	Members,
	PlacedSteps,
	RoleRules,
	SpaceOffers,
} from "./application/ports";
import { readProjectSecretValues } from "./application/read-project-secret-values";
import { readStepSecretValues } from "./application/read-step-secret-values";
import { removeKeptProjectSecret } from "./application/remove-kept-project-secret";
import { removeKeptSpaceSecret } from "./application/remove-kept-space-secret";
import { removeProjectSecret } from "./application/remove-project-secret";
import { removeSpaceSecret } from "./application/remove-space-secret";
import { saveKeptProjectSecret } from "./application/save-kept-project-secret";
import { saveKeptSpaceSecret } from "./application/save-kept-space-secret";
import { saveProjectSecret } from "./application/save-project-secret";
import { saveSpaceSecret } from "./application/save-space-secret";
import { takeKeptProjectSecret } from "./application/take-kept-project-secret";
import { takeKeptSpaceSecret } from "./application/take-kept-space-secret";
import { takeProjectSecret } from "./application/take-project-secret";
import { takeSpaceSecret } from "./application/take-space-secret";

/**
 * The wiring of the Project and Space secrets: it binds each use case to
 * its ports. It builds no adapter of its own.
 */

/** What the composition gives the Project and Space secrets. */
export type ProjectsDeps = {
	store: ProjectSecretStore;
	spaceStore: SpaceSecretStore;
	calls: HostCalls;
	/** Where the engine has a Project (a removed one too) and a run. */
	places: EnginePlaces;
	/** The Host that keeps a Space, or null for one this computer keeps. */
	spaces: KeeperSpaces;
	members: Members;
	rules: RoleRules;
	/** The calls of runs this Host walks or relays, to the Devices they are placed on. */
	work: PlacedSteps;
	offers: SpaceOffers;
	/** The Person who owns this computer: the only one who acts through its key. */
	ownerId: string;
	/** How long one call of a Host may take. Default: `PERSONAL_DEADLINE_MS`. */
	deadlineMs?: number;
};

type ProjectRef = { spaceId: string; projectId: string };
type StepRun = ProjectRef & { runId: string };

/**
 * This computer as the Host that keeps a Space, as a paired Device asks
 * it for the secrets of the Space's Projects (ADR 13, decisions 2, 3
 * and 6). The Host admitted the Caller before the call reached here
 * (`Devices.admit`). Every call checks, from this Host's own records,
 * that it keeps the Space, and that the Project is in it. `list`: the
 * Caller's Person is a Member of the Space. `set`, `remove`, `take`:
 * their role there saves Flows. `values`: the step runs on the Caller's
 * Device now, for a Member or a Device that offers profiles to the Space.
 */
export type ProjectSecretsHost = {
	list(caller: Caller, input: ProjectRef): Promise<ProjectSecretName[]>;
	values(
		caller: Caller,
		input: StepRun & { names?: readonly string[] },
	): Promise<Record<string, string>>;
	set(
		caller: Caller,
		input: ProjectRef & { name: string; value: string },
	): Promise<void>;
	remove(caller: Caller, input: ProjectRef & { name: string }): Promise<void>;
	take(
		caller: Caller,
		input: ProjectRef & { name: string },
	): Promise<string | null>;
	/** A Space's secrets (ADR 18): the same rules, for every project of the Space. */
	space: {
		list(
			caller: Caller,
			input: { spaceId: string },
		): Promise<ProjectSecretName[]>;
		set(
			caller: Caller,
			input: { spaceId: string; name: string; value: string },
		): Promise<void>;
		remove(
			caller: Caller,
			input: { spaceId: string; name: string },
		): Promise<void>;
		take(
			caller: Caller,
			input: { spaceId: string; name: string },
		): Promise<string | null>;
	};
};

/**
 * The Project and Space secrets, both halves. `device` is the engine's
 * `ProjectSecrets` port (ADR 13): per call, by the Project's Space, at
 * the Host that keeps it, or here for a Space this computer keeps. A
 * Host that cannot be reached, or does not answer in time, throws
 * `HostUnreachableError`: a step then reads the secret as missing.
 */
export type Projects = { host: ProjectSecretsHost; device: ProjectSecrets };

export function wireProjects(deps: ProjectsDeps): Projects {
	const ports = {
		...deps,
		deadlineMs: deps.deadlineMs ?? PERSONAL_DEADLINE_MS,
	};
	const list = listProjectSecrets(ports);
	const values = readProjectSecretValues(ports);
	const set = saveProjectSecret(ports);
	const remove = removeProjectSecret(ports);
	const take = takeProjectSecret(ports);
	const kept = listKeptValues(ports);
	const spaceList = listSpaceSecrets(ports);
	const spaceSet = saveSpaceSecret(ports);
	const spaceRemove = removeSpaceSecret(ports);
	const spaceTake = takeSpaceSecret(ports);
	return {
		host: {
			list: listKeptProjectSecrets(ports),
			values: readStepSecretValues(ports),
			set: saveKeptProjectSecret(ports),
			remove: removeKeptProjectSecret(ports),
			take: takeKeptProjectSecret(ports),
			space: {
				list: listKeptSpaceSecrets(ports),
				set: saveKeptSpaceSecret(ports),
				remove: removeKeptSpaceSecret(ports),
				take: takeKeptSpaceSecret(ports),
			},
		},
		device: {
			list: (project, personId) => list({ project, personId }),
			values: (step, names) => values({ step, names }),
			set: (project, name, value, personId) =>
				set({ project, name, value, personId }),
			remove: (project, name, personId) => remove({ project, name, personId }),
			take: (project, name, personId) => take({ project, name, personId }),
			kept: (project, names) => kept({ project, names }),
			space: {
				list: (spaceId, personId) => spaceList({ spaceId, personId }),
				set: (spaceId, name, value, personId) =>
					spaceSet({ spaceId, name, value, personId }),
				remove: (spaceId, name, personId) =>
					spaceRemove({ spaceId, name, personId }),
				take: (spaceId, name, personId) =>
					spaceTake({ spaceId, name, personId }),
			},
		},
	};
}
