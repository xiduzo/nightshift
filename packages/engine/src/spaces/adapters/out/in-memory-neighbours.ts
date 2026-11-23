import type { Permissions } from "@nightshift/auth";
import type { Actor } from "../../../contract";
import type { SpaceAccess } from "../../application/ports";
import { inMemorySpacePolicies } from "./in-memory-space-policies";

/**
 * `inMemorySpacesPorts`, which gives a use-case test every port of the
 * slice at once. Test code: production code never imports this file.
 */

/** Every port of spaces in memory at once: where each use-case test starts. */

export type InMemorySpaceAccess = SpaceAccess & {
	opened: { actor: Actor; spaceId: string; need?: Permissions }[];
	refuse(error: unknown): void;
};

export function inMemorySpaceAccess(): InMemorySpaceAccess {
	let refusal: { error: unknown } | null = null;
	const access: InMemorySpaceAccess = {
		opened: [],
		refuse: (error) => {
			refusal = { error };
		},
		async openSpace(actor, request) {
			access.opened.push({ actor, ...request });
			if (refusal && "personId" in actor) throw refusal.error;
		},
	};
	return access;
}

export function inMemorySpacesPorts() {
	return {
		access: inMemorySpaceAccess(),
		spacePolicies: inMemorySpacePolicies(),
	};
}
