import { secretNameSchema } from "@nightshift/flows";
import type { Actor } from "../../../contract";
import {
	movedValue,
	removeIn,
	type SecretScope,
	saveIn,
	valueIn,
} from "../../scopes";
import type { ScopePorts } from "./save-secret";

/** The name to move, and the scope it moves to. */
export type MoveSecret = { name: string; to: SecretScope };

/**
 * Moves a saved secret to the other scope of this computer's Person, and
 * the person never types it again (ADR 13, decision 7): it reads the
 * value where it is, saves it in `to`, then removes the copy it moved
 * from. Refuses when the scope it moves from has no value of that name.
 * The refusal names the secret, never its value.
 */
export const moveSecret =
	(ports: ScopePorts) =>
	async (_actor: Actor, { name, to }: MoveSecret): Promise<void> => {
		secretNameSchema.parse(name);
		const from: SecretScope = to === "personal" ? "computer" : "personal";
		const value = movedValue(await valueIn(ports, from, name), from, name);
		// Saved in its new scope first: a failure there keeps the old copy.
		await saveIn(ports, to, name, value);
		await removeIn(ports, from, name);
	};
