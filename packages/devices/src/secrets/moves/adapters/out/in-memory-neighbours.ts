import type { WorkReply, WorkRequest } from "../../../../contract";
import { inMemoryHostCalls } from "../../../calls/adapters/out/in-memory-host-calls";
import type {
	MoveWork,
	OtherDevices,
	OwnSecrets,
} from "../../application/ports";

/**
 * The in-memory adapters of the ports that another vertical or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemoryMovesPorts`, which gives a use-case test every port at once.
 * Test code: production code never imports this file.
 */

type Device = NonNullable<Awaited<ReturnType<OtherDevices["get"]>>>;

/** The Devices paired with a test Host. */
export function inMemoryOtherDevices() {
	const devices = new Map<string, Device>();
	const twin = {
		devices,
		add(device: Partial<Device> & { id: string }) {
			devices.set(device.id, {
				name: device.id,
				ownerId: "person-ada",
				homeHost: "host.lan",
				revokedAt: null,
				...device,
			});
		},
		async get(id: string) {
			return devices.get(id) ?? null;
		},
	};
	return twin satisfies OtherDevices;
}

/** A work hub of a test: the Devices online, the replies each gives, and every call it sent. */
export function inMemoryMoveWork() {
	const online = new Set<string>();
	const replies = new Map<string, WorkReply[]>();
	const sent: { deviceId: string; request: WorkRequest }[] = [];
	const twin = {
		online: async (deviceId: string, _spaceId: string) => online.has(deviceId),
		isOnline: online,
		replies,
		sent,
		async *call(deviceId: string, request: WorkRequest) {
			sent.push({ deviceId, request });
			yield* replies.get(deviceId) ?? [];
		},
	};
	return twin satisfies MoveWork;
}

/** This computer's own secrets in a test: each move it was asked, in order. */
export function inMemoryOwnSecrets() {
	const moved: unknown[][] = [];
	const twin = {
		moved,
		async moveSecret(name: string, to: string) {
			moved.push(["move", name, to]);
		},
		async moveToProject(
			name: string,
			from: string,
			project: { spaceId: string; projectId: string },
			personId: string,
		) {
			moved.push(["project", name, from, project, personId]);
		},
		async removeSecret(name: string, scope?: string) {
			moved.push(["remove", name, scope]);
		},
	};
	return twin satisfies OwnSecrets;
}

/** Every port of the moves, for a computer of Ada with nothing paired yet. */
export function inMemoryMovesPorts() {
	return {
		devices: inMemoryOtherDevices(),
		work: inMemoryMoveWork(),
		calls: inMemoryHostCalls(),
		own: inMemoryOwnSecrets(),
		ownerId: "person-ada",
		deadlineMs: 1_000,
	};
}
