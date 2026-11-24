import type { Access, ComputerAccess } from "../../access";
import type { Scopes } from "../scopes";
import { listProjectSecrets } from "./application/list-project-secrets";
import { listSecrets } from "./application/list-secrets";
import { listSpaceSecrets } from "./application/list-space-secrets";
import { moveSecret } from "./application/move-secret";
import { moveSecretFromProject } from "./application/move-secret-from-project";
import { moveSecretFromSpace } from "./application/move-secret-from-space";
import { moveSecretToProject } from "./application/move-secret-to-project";
import { moveSecretToSpace } from "./application/move-secret-to-space";
import { removeProjectSecret } from "./application/remove-project-secret";
import { removeSecret } from "./application/remove-secret";
import { removeSpaceSecret } from "./application/remove-space-secret";
import { saveProjectSecret } from "./application/save-project-secret";
import { saveSecret } from "./application/save-secret";
import { saveSpaceSecret } from "./application/save-space-secret";

/**
 * The wiring of the edits: what a person lists, saves, removes and moves
 * of the secrets of this computer, the Personal ones, a Project's and a
 * Space's. It binds each use case to the ports of the scopes. It builds
 * no adapter of its own.
 */

/** Who may edit: the owner of this computer, and a role in the Space. */
export type EditAccess = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	access: Pick<Access, "openSpace">;
};

/** The use cases of the edits, bound to their ports. */
export type Edits = {
	listSecrets: ReturnType<typeof listSecrets>;
	saveSecret: ReturnType<typeof saveSecret>;
	removeSecret: ReturnType<typeof removeSecret>;
	moveSecret: ReturnType<typeof moveSecret>;
	listProjectSecrets: ReturnType<typeof listProjectSecrets>;
	saveProjectSecret: ReturnType<typeof saveProjectSecret>;
	removeProjectSecret: ReturnType<typeof removeProjectSecret>;
	moveSecretToProject: ReturnType<typeof moveSecretToProject>;
	moveSecretFromProject: ReturnType<typeof moveSecretFromProject>;
	listSpaceSecrets: ReturnType<typeof listSpaceSecrets>;
	saveSpaceSecret: ReturnType<typeof saveSpaceSecret>;
	removeSpaceSecret: ReturnType<typeof removeSpaceSecret>;
	moveSecretToSpace: ReturnType<typeof moveSecretToSpace>;
	moveSecretFromSpace: ReturnType<typeof moveSecretFromSpace>;
};

export function wireEdits(scopes: Scopes & EditAccess): Edits {
	return {
		listSecrets: listSecrets(scopes),
		saveSecret: saveSecret(scopes),
		removeSecret: removeSecret(scopes),
		moveSecret: moveSecret(scopes),
		listProjectSecrets: listProjectSecrets(scopes),
		saveProjectSecret: saveProjectSecret(scopes),
		removeProjectSecret: removeProjectSecret(scopes),
		moveSecretToProject: moveSecretToProject(scopes),
		moveSecretFromProject: moveSecretFromProject(scopes),
		listSpaceSecrets: listSpaceSecrets(scopes),
		saveSpaceSecret: saveSpaceSecret(scopes),
		removeSpaceSecret: removeSpaceSecret(scopes),
		moveSecretToSpace: moveSecretToSpace(scopes),
		moveSecretFromSpace: moveSecretFromSpace(scopes),
	};
}
