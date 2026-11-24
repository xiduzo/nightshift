import type { Actor } from "../../../contract";
import { removeIn, type SecretScope } from "../../scopes";
import type { ScopePorts } from "./save-secret";

/** The name to remove, and from where. Default: this computer. */
export type RemoveSecret = { name: string; scope?: SecretScope };

/**
 * Removes the saved value of a scope. From this computer, its name and its
 * use time go too: the environment takes over. Only the owner of this
 * computer may.
 */
export const removeSecret =
	(ports: ScopePorts) =>
	async (
		actor: Actor,
		{ name, scope = "computer" }: RemoveSecret,
	): Promise<void> => {
		ports.computerAccess.openComputer(actor);
		await removeIn(ports, scope, name);
	};
