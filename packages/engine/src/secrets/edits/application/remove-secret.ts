import type { Actor } from "../../../contract";
import { removeIn, type SecretScope } from "../../scopes";
import type { ScopePorts } from "./save-secret";

/** The name to remove, and from where. Default: this computer. */
export type RemoveSecret = { name: string; scope?: SecretScope };

/**
 * Removes the saved value of a scope. From this computer, its name and
 * its use time go too: the environment takes over. The doors check the
 * owner of this computer first, so the actor is not read.
 */
export const removeSecret =
	(ports: ScopePorts) =>
	async (
		_actor: Actor,
		{ name, scope = "computer" }: RemoveSecret,
	): Promise<void> => {
		await removeIn(ports, scope, name);
	};
