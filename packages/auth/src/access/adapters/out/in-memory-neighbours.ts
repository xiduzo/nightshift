import type { HostPolicy } from "../../../host-access";
import type { Role, Space } from "../../../spaces";
import { openRequest } from "../../application/open-request";
import type {
	LocalSessions,
	MemberSpaces,
	SyncDocuments,
} from "../../application/ports";
import type { DocumentOf, SyncDeviceKey } from "../../domain/sync-access";
import { inMemoryOrganizations } from "./in-memory-organizations";
import {
	inMemorySessionReader,
	type TestSession,
	tokenOf,
} from "./in-memory-session-reader";

/**
 * The in-memory adapters of the ports that another vertical fills
 * (`@filledBy` in `application/ports.ts`), and `inMemoryAccessPorts`,
 * which gives a use-case test every port of access at once. Test code:
 * production code never imports this file.
 */

/** The Spaces of the Persons of a test, with a role each, and the reads asked. */
export function inMemoryMemberSpaces() {
	const spaces: (Space & { personId: string })[] = [];
	const twin = {
		spaces,
		/** Every read of a Person's Spaces, by Person. */
		reads: [] as string[],
		/** The personal Spaces made, by Person. */
		made: [] as string[],
		/** Makes the Person a member of a Space. */
		join(personId: string, space: Space) {
			spaces.push({ ...space, personId });
		},
		async spacesOf(personId: string): Promise<Space[]> {
			twin.reads.push(personId);
			return spaces
				.filter((s) => s.personId === personId)
				.map(({ personId: _, ...space }) => space);
		},
		async ensurePersonalSpace(personId: string) {
			const found = spaces.find((s) => s.personId === personId && s.personal);
			if (found) return found.id;
			twin.made.push(personId);
			const id = `personal-${personId}`;
			twin.join(personId, {
				id,
				name: "Personal",
				personal: true,
				role: "owner",
			});
			return id;
		},
		async roleOf(personId: string, spaceId: string): Promise<Role | null> {
			return (
				spaces.find((s) => s.personId === personId && s.id === spaceId)?.role ??
				null
			);
		},
	};
	return twin satisfies MemberSpaces;
}

/** The local Person's session of a test: `personId`'s, through the session twin. */
export function inMemoryLocalSessions(
	sessions: ReturnType<typeof inMemorySessionReader>,
	personId: string,
) {
	let headers: Headers | null = null;
	const local = (): Headers => {
		headers ??= sessions.signIn(personId);
		return headers;
	};
	const twin = {
		async resolve(request: Headers) {
			const own = tokenOf(request) ? await sessions.read(request) : null;
			if (own) return { session: own, headers: request };
			return { session: await sessions.read(local()), headers: local() };
		},
		async headers(request: Headers) {
			return tokenOf(request) ? request : local();
		},
	};
	return twin satisfies LocalSessions<TestSession>;
}

/** The documents a test serves: set `documents`, `deviceKeys` and `keptOwners`. */
export function inMemorySyncDocuments(
	localSession: LocalSessions<TestSession>,
	ownerId: string,
) {
	const twin = {
		ownerId,
		localSession,
		/** The Host's rules: a test sets them. */
		policy: undefined as HostPolicy | undefined,
		documents: new Map<string, DocumentOf>(),
		deviceKeys: new Map<string, SyncDeviceKey>(),
		keptOwners: new Map<string, string>(),
		/** This computer's own connections come from this address. */
		isThisComputer: (peer: string | null) => peer === "this-computer",
		async documentOf(name: string) {
			return twin.documents.get(name) ?? null;
		},
		async keptOwner(name: string) {
			return twin.keptOwners.get(name) ?? null;
		},
		async deviceKey(token: string) {
			return twin.deviceKeys.get(token) ?? null;
		},
	};
	return twin satisfies SyncDocuments<TestSession>;
}

/**
 * Every port of access in memory at once: where each use-case test starts.
 * `local` is the session of this computer's Person, `owner`. `openRequest`
 * is bound to the same ports, as the wire binds it.
 */
export function inMemoryAccessPorts() {
	const sessionReader = inMemorySessionReader();
	const emails = new Map<string, string>();
	const members = inMemoryMemberSpaces();
	const organizations = inMemoryOrganizations({
		personOf: (headers) => {
			const token = tokenOf(headers);
			return (token && sessionReader.sessions.get(token)?.user.id) || null;
		},
		emailOf: (personId) => emails.get(personId) ?? `${personId}@example.com`,
	});
	let ids = 0;
	const ports = {
		sessionReader,
		members,
		organizations,
		newId: () => `id${++ids}-0000-0000`,
	};
	const local = inMemoryLocalSessions(sessionReader, "owner");
	return {
		...ports,
		emails,
		local,
		documents: inMemorySyncDocuments(local, "owner"),
		openRequest: openRequest<TestSession>(ports),
	};
}
