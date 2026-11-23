import { isDeviceKey } from "../../devices";
import { type Permissions, roleAllows } from "../../spaces";
import type { SessionOf } from "../domain/space-access";
import type {
	SpaceDocumentOf,
	SyncAccess,
	SyncGrant,
	SyncRequest,
} from "../domain/sync-access";
import { OPEN_HOST } from "../host-access";
import type { OpenRequest, RequestAccessOf } from "./open-request";
import type { MemberSpaces, SyncDocuments } from "./ports";

/** What a role needs to change a flow document over sync. */
const FLOW_WRITE: Permissions = {
	flow: ["save", "remove"],
	schedule: ["save"],
};

/** What a role needs to change a knowledge document over sync: its steps change the knowledge. */
const KNOWLEDGE_WRITE: Permissions = { run: ["start"] };

/** What a Device's role needs to change a document of each kind. Null: no Device changes it. */
const DEVICE_WRITE: Record<SpaceDocumentOf["kind"], Permissions | null> = {
	space: null,
	flows: FLOW_WRITE,
	knowledge: KNOWLEDGE_WRITE,
};

export type AuthorizeDocumentPorts<S> = {
	members: Pick<MemberSpaces, "roleOf">;
	documents: SyncDocuments<S>;
	/** The access of a request (`openRequest`, bound by the wire). */
	openRequest: (request: OpenRequest<S>) => Promise<RequestAccessOf<S>>;
};

/**
 * Who may open which document, by its kind. The request's session decides:
 * a request from this computer (`isThisComputer`) without a session of its
 * own gets the local Person's session, exactly as the procedures do, so
 * one rule decides both.
 *
 * - `device:<id>`: its owner, to change it. On a Host, the owner of a
 *   document it keeps for a paired Device is that Device's owner
 *   (`keptOwner`).
 * - `space:<id>`: a Member of that Space, read-only. A Yjs update cannot
 *   be checked per action (a rename, a removal), so every write to a
 *   Space document goes through the procedures, which check the role
 *   and log an event.
 * - `flows:<project id>` and `flows-history:<project id>`: a Member of the
 *   Project's Space, read-only. A browser saves a flow through the
 *   procedures. A Device of a Member whose role may save and remove flows
 *   and save schedules changes them: it keeps a copy, and its edits
 *   merge (ADR 2). The daemon that saves checks the flow.
 * - `knowledge:<project id>`: a Member of the Project's Space, read-only.
 *   A Device of a Member whose role may start runs changes it: it runs
 *   the steps that change the knowledge, and publishes their files (ADR
 *   4). A browser changes knowledge only through the procedures.
 *
 * A token that is a Device key (`deviceKey`) is a Device, never a session:
 * it opens its own Device document, only on its home Host (to change it),
 * the Space documents of the Spaces its owner is a Member of (to read),
 * and the flow and knowledge documents of their Projects. On its home Host it also reads
 * the Device documents of its owner's other Devices: the ones the Host
 * keeps for them, and the Host's own when its owner owns the Host (ADR 1,
 * decision 2). A Device document holds secret names, never their values.
 */
export const authorizeDocument =
	<S extends SessionOf>(ports: AuthorizeDocumentPorts<S>) =>
	async (request: SyncRequest): Promise<SyncAccess | SyncGrant> => {
		const { documents } = ports;
		const ownerOf = async (documentName: string) =>
			(await documents.keptOwner?.(documentName)) ?? documents.ownerId;

		/**
		 * A document of a Space: read-only for a Member of that Space. A
		 * Device (`device`) of a Member who may change flows writes a flow
		 * document, and one of a Member who may start runs writes a knowledge
		 * document.
		 */
		const spaceAccess = async (
			personId: string,
			space: SpaceDocumentOf,
			device = false,
		): Promise<SyncAccess> => {
			const role = await ports.members.roleOf(personId, space.spaceId);
			if (role === null) return false;
			const needs = DEVICE_WRITE[space.kind];
			return device && needs && roleAllows(role, needs) ? "write" : "read";
		};

		const { documentName, token, peer } = request;
		const document = await documents.documentOf(documentName);
		if (!document) return false;
		if (isDeviceKey(token)) {
			const key = await documents.deviceKey?.(token);
			if (!key) return false;
			const context = { deviceId: key.deviceId };
			if (document.kind === "device") {
				const owners =
					key.home && (await ownerOf(documentName)) === key.personId;
				if (!owners) return false;
				return {
					access: document.deviceId === key.deviceId ? "write" : "read",
					context,
				};
			}
			const access = await spaceAccess(key.personId, document, true);
			return access ? { access, context } : false;
		}
		const local = documents.isThisComputer(peer, request.request);
		const { session, hostAccess } = await ports.openRequest({
			headers: request.request.headers,
			local: local ? documents.localSession : null,
			policy: documents.policy ?? OPEN_HOST,
		});
		if (!session || !hostAccess.allowed) return false;
		if (document.kind === "device") {
			return session.user.id === (await ownerOf(documentName))
				? "write"
				: false;
		}
		return spaceAccess(session.user.id, document);
	};
