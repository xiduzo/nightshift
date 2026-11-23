import type { RowBatch } from "@nightshift/engine";
import type {
	DeviceFacts,
	DeviceHistory,
	EngineDeviceRows,
	PersonalSpaces,
	ThisComputer,
} from "../../application/ports";
import type { DevicePresence } from "../../domain/paired-device";
import {
	inMemoryBatch,
	inMemoryDeviceStore,
	runInMemory,
} from "./in-memory-device-store";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemoryRegistryPorts`, which gives a use-case test every port of the
 * slice at once. Test code: production code never imports this file.
 */

type Fact = Parameters<DeviceFacts["log"]>[0];

/** The facts logged, in order: each runs its batch first, as the engine's one batch does. */
export function inMemoryDeviceFacts() {
	const logged: { fact: Fact; withRows: boolean }[] = [];
	const twin = {
		logged,
		async log(fact: Fact, before?: RowBatch) {
			if (before) runInMemory(before);
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

/** The engine's rows of a Device: each batch, when it runs, notes what it named. */
export function inMemoryEngineDeviceRows() {
	const ran: string[] = [];
	const adopts: Parameters<EngineDeviceRows["adopt"]>[0][] = [];
	const twin = {
		ran,
		adopts,
		forget: (deviceId: string) =>
			inMemoryBatch(() => {
				ran.push(`forget ${deviceId}`);
			}),
		adopt: (move: Parameters<EngineDeviceRows["adopt"]>[0]) => {
			adopts.push(move);
			return inMemoryBatch(() => {
				ran.push(`adopt ${move.from} ${move.to}`);
			});
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

/** Every port of registry in memory at once: where each use-case test starts. */
export function inMemoryRegistryPorts() {
	let clock = 1_000_000;
	let ids = 0;
	const now = () => clock;
	return {
		store: inMemoryDeviceStore({ now }),
		facts: inMemoryDeviceFacts(),
		history: inMemoryDeviceHistory(),
		engineRows: inMemoryEngineDeviceRows(),
		spaces: inMemoryPersonalSpaces(),
		computer: inMemoryThisComputer(),
		online: new Map() as DevicePresence,
		documentPrefix: "device:",
		newId: () => `id-${++ids}`,
		now,
		/** Moves the clock of the test on. */
		later(ms: number) {
			clock += ms;
		},
	};
}
