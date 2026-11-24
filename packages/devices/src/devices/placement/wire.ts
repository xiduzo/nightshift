import { wireSpaces } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import {
	deviceNameIn,
	HostUnreachableError,
	planNodes,
	UNREACHABLE_DEVICE,
} from "@nightshift/engine";
import { keptByHomeHost, personInSpace } from "../../links";
import { remoteDevice } from "../../work";
import type { PlacementDeps } from "./application/create-placement";
import {
	createPlacement,
	type PlacementModule,
} from "./application/create-placement";
import type { SpacePeople } from "./application/ports";

function spacePeopleOf(db: Database): SpacePeople {
	const spaces = wireSpaces({ db });
	return {
		personInSpace: (spaceId, personId) => personInSpace(db, spaceId, personId),
		personalSpaceIdBySlug: (personId) =>
			spaces.personal.findPersonalSpaceBySlug({ personId }),
		personNames: (ids) => spaces.members.listPersonNames({ ids }),
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
			deps: Omit<PlacementDeps, "spacePeople" | "engineFns"> & { db: Database },
		): PlacementModule {
			const { db, ...rest } = deps;
			return createPlacement({
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
		},
	};
}
