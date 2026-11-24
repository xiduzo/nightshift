import type { RowBatch } from "@nightshift/engine";
import type {
	DeviceFacts,
	DeviceHistory,
	EngineDeviceRows,
	PersonalSpaces,
	ThisComputer,
} from "../../application/ports";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`). Test code: production code never
 * imports this file.
 */

type Fact = Parameters<DeviceFacts["log"]>[0];

/** One fact a test logged, and whether rows came with it. */
export interface LoggedFact {
	fact: Fact;
	withRows: boolean;
}

/** The facts logged, in order: `run` runs the batch of each first, as the engine's one batch does. */
export function inMemoryDeviceFacts(
	run: (batch: RowBatch) => Promise<void>,
): DeviceFacts & { logged: LoggedFact[] } {
	const logged: LoggedFact[] = [];
	const twin = {
		logged,
		async log(fact: Fact, before?: RowBatch) {
			if (before) await run(before);
			logged.push({ fact, withRows: before !== undefined });
		},
	};
	return twin satisfies DeviceFacts;
}

/** The event log of a test: the latest presence fact of each Device, and the last count of each Walker. */
export function inMemoryDeviceHistory() {
	const presence = new Map<string, string>();
	const walkerSeqs = new Map<string, number>();
	const twin = {
		presence,
		walkerSeqs,
		async devicePresence() {
			return new Map(presence);
		},
		async lastWalkerSeq(walkerId: string) {
			return walkerSeqs.get(walkerId) ?? 0;
		},
	};
	return twin satisfies DeviceHistory;
}

/** The engine's rows of a Device: `note` makes the statement that notes, when it runs, what it named. */
export function inMemoryEngineDeviceRows(note: (what: string) => RowBatch) {
	const adopts: Parameters<EngineDeviceRows["adopt"]>[0][] = [];
	const twin = {
		adopts,
		forget: (deviceId: string) => note(`forget ${deviceId}`),
		adopt: (move: Parameters<EngineDeviceRows["adopt"]>[0]) => {
			adopts.push(move);
			return note(`adopt ${move.from} ${move.to}`);
		},
	};
	return twin satisfies EngineDeviceRows;
}

/** The personal Spaces of a test: a Person's is `personal-<id>` once `add` names it. */
export function inMemoryPersonalSpaces() {
	const spaces = new Map<string, string>();
	const twin = {
		spaces,
		add(personId: string) {
			spaces.set(personId, `personal-${personId}`);
		},
		idOf: async (personId: string) => spaces.get(personId) ?? null,
	};
	return twin satisfies PersonalSpaces;
}

/** A computer as a test says it: a Mac named "studio", outside a container. */
export function inMemoryThisComputer(
	facts: {
		hostName?: string;
		container?: boolean;
		platform?: string;
		env?: Record<string, string | undefined>;
	} = {},
) {
	return {
		hostName: () => facts.hostName ?? "studio.local",
		inContainer: () => facts.container ?? false,
		platform: () => facts.platform ?? "darwin",
		env: () => facts.env ?? {},
	} satisfies ThisComputer;
}
