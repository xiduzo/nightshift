import { personalSpaceIdBySlug, personNames } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import {
	deviceNameIn,
	HostUnreachableError,
	planNodes,
	UNREACHABLE_DEVICE,
} from "@nightshift/engine";
import { keptByHomeHost, personInSpace } from "../links";
import { remoteDevice } from "../work";
import type { PlacementDeps } from "./application/create-placement";
import {
	createPlacement,
	type PlacementModule,
} from "./application/create-placement";
import { listDevicesFor } from "./application/list-devices-for";
import { listPlacements } from "./application/list-placements";
import { moveRunTo } from "./application/move-run-to";
import { placeOnDevice } from "./application/place-on-device";
import { planRun } from "./application/plan-run";
import type { SpacePeople } from "./application/ports";

function spacePeopleOf(db: Database): SpacePeople {
	return {
		personInSpace: (spaceId, personId) => personInSpace(db, spaceId, personId),
		personalSpaceIdBySlug: (personId) => personalSpaceIdBySlug(db, personId),
		personNames: (ids) => personNames(db, ids),
		keptByHomeHost: (spaceId) => keptByHomeHost(db, spaceId),
	};
}

/**
 * The wiring of placement: which Device a step runs on, and which of a
 * Person's Devices a run may use.
 */
export function wirePlacement() {
	return {
		createPlacement(
			deps: Omit<PlacementDeps, "spacePeople"> & { db: Database },
		): PlacementModule {
			const { db, ...rest } = deps;
			const placement = createPlacement({
				...rest,
				spacePeople: spacePeopleOf(db),
				engineFns: {
					planNodes,
					deviceNameIn,
					HostUnreachableError,
					UNREACHABLE_DEVICE,
					remoteDevice,
				},
			});
			void planRun(placement);
			void placeOnDevice(placement);
			void moveRunTo(placement);
			void listDevicesFor(placement);
			void listPlacements(placement);
			return placement;
		},
	};
}
