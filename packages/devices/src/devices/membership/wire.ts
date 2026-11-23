import { randomUUID } from "node:crypto";
import { wireSpaces } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { device } from "@nightshift/db/schema";
import {
	HostUnreachableError,
	NIGHT_SHIFT,
	type RowBatch,
} from "@nightshift/engine";
import type { DeviceCopies } from "@nightshift/engine/settings";
import { and, eq, isNull } from "drizzle-orm";
import type { DevicesDeps } from "../../devices-runtime";
import {
	type DeviceKeyStore,
	type DeviceLinks,
	type HostLinks,
	NotPairedError,
} from "../../links";
import type { PeerEngine } from "../../wire-peers-engine";
import { startKeepFinishing } from "./adapters/in/keep-finishing";
import { drizzleMembershipRecord } from "./adapters/out/drizzle-membership-record";
import { fsDatabaseCopy } from "./adapters/out/fs-database-copy";
import {
	createHomeMembership,
	type HomeMembership,
} from "./application/create-home-membership";
import { finishMembership } from "./application/finish-membership";
import { leaveHost } from "./application/leave-host";
import { mergePending } from "./application/merge-pending";
import { mergePersonal } from "./application/merge-personal";
import type {
	Batches,
	EngineKernel,
	Ids,
	PairedDevices,
	PersonalSpaces,
	Wait,
} from "./application/ports";
import { previewMerge } from "./application/preview-merge";

export type { HomeMembership };

function personalSpacesOf(db: Database): PersonalSpaces {
	const spaces = wireSpaces({ db });
	return {
		personalId: (personId) => spaces.personal.findPersonalSpace({ personId }),
		exists: (spaceId) => spaces.hasSpace({ spaceId }),
		adoptBatch: async (input) =>
			(await spaces.personal.adoptPersonalSpace(input)) as unknown as RowBatch,
		splitBatch: async (input) =>
			(await spaces.personal.splitPersonalSpace(input)) as unknown as RowBatch,
	};
}

function pairedDevicesOf(db: Database): PairedDevices {
	return {
		async hasPaired() {
			const [paired] = await db
				.select({ id: device.id })
				.from(device)
				.where(and(eq(device.self, false), isNull(device.revokedAt)))
				.limit(1);
			return paired !== undefined;
		},
	};
}

function batchesOf(db: Database): Batches {
	return {
		run: (batch) => db.batch(batch as Parameters<Database["batch"]>[0]),
	};
}

const wait: Wait = {
	sleep: (ms) =>
		new Promise((resolve) => {
			const timer = setTimeout(resolve, ms);
			timer.unref?.();
		}),
};

const ids: Ids = {
	spaceId: () => randomUUID(),
};

const engineKernel: EngineKernel = {
	nightShift: NIGHT_SHIFT,
	isHostUnreachable: (error) => error instanceof HostUnreachableError,
};

/**
 * The wiring of membership: this computer's membership of its home Host
 * (ADR 1), the merge of its Personal into the Host's, and the split when
 * it leaves. Same call shape as the old package `wire-membership`.
 */
export function wireMembership(
	deps: Pick<
		DevicesDeps,
		"db" | "spaces" | "flows" | "self" | "ownerId" | "dataDir"
	>,
	engine: PeerEngine,
	at: {
		links: DeviceLinks;
		hostLinks: HostLinks;
		keys: DeviceKeyStore;
		copies: DeviceCopies;
	},
): { membership: HomeMembership; finishing: AbortController } {
	const record = drizzleMembershipRecord(deps.db);
	const membership = createHomeMembership({
		engine,
		links: at.links,
		hostLinks: at.hostLinks,
		keys: at.keys,
		copies: at.copies,
		spaces: deps.spaces,
		flows: deps.flows,
		self: deps.self,
		ownerId: deps.ownerId,
		dataDir: deps.dataDir,
		record,
		personalSpaces: personalSpacesOf(deps.db),
		pairedDevices: pairedDevicesOf(deps.db),
		databaseCopy: fsDatabaseCopy(deps.db),
		batches: batchesOf(deps.db),
		wait,
		ids,
		engineKernel,
		isNotPaired: (error) => error instanceof NotPairedError,
	});
	const finishing = new AbortController();
	const bound = {
		pending: mergePending(membership),
		preview: previewMerge(membership),
		merge: mergePersonal(membership),
		leave: leaveHost(membership),
		finish: finishMembership(membership),
	};
	startKeepFinishing(bound.finish.keepFinishing, finishing.signal);
	return { membership, finishing };
}
