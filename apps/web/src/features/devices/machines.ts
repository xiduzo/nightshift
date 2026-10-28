import type { SpaceComputer, SpaceView } from "./space-view";

/**
 * The computers a schedule or a flow needs, as the Space knows them now:
 * the one that starts its schedules (the Host, else this computer), and
 * every computer by name or by id, each with whether it is online.
 */

/** A computer of the Space, as a run needs it. */
export type Machine = {
	/** Null for a Host this computer knows only by its link. */
	id: string | null;
	name: string;
	/** Null when this computer cannot tell. */
	online: boolean | null;
	/** Epoch ms. For a Host: when its link last changed. */
	lastSeenAt: number | null;
	thisDevice: boolean;
	/** The projects it has a copy of. Null when this computer cannot tell. */
	projectIds: string[] | null;
};

export type SpaceMachines = {
	/** The computer that starts every schedule of the Space. */
	starter: Machine;
	/** Whether `starter` is a Host. False: this computer, alone in the Space. */
	starterIsHost: boolean;
	/** Every computer of the Space but a linked Host, this computer first. */
	computers: Machine[];
	/** A computer by the name a schedule or a node gives it. */
	byName(name: string): Machine | null;
	/** A computer by its id, as a profile names it. */
	byId(id: string): Machine | null;
};

function machineOf(computer: SpaceComputer): Machine {
	return {
		id: computer.id,
		name: computer.name,
		// This computer runs this page's Night Shift: it is online.
		online: computer.thisDevice
			? true
			: computer.paired?.revokedAt != null
				? false
				: computer.online,
		lastSeenAt: computer.lastSeenAt,
		thisDevice: computer.thisDevice,
		projectIds: computer.clones.map((clone) => clone.projectId),
	};
}

export function spaceMachines(view: SpaceView): SpaceMachines {
	const computers = [...view.yours, ...view.members].map(machineOf);
	const host = view.host;
	let starter: Machine;
	let starterIsHost: boolean;
	if (host.kind === "linked") {
		// The Host is a Device of the Space too when it has a copy of a project.
		const known = computers.find(
			(c) => c.id === host.host.hostId || c.name === host.host.name,
		);
		starter = {
			id: known?.id ?? null,
			name: host.host.name,
			online:
				host.host.status === "online"
					? true
					: host.host.status === "connecting"
						? null
						: false,
			lastSeenAt: host.host.since,
			thisDevice: false,
			projectIds: known?.projectIds ?? [],
		};
		starterIsHost = true;
	} else {
		const self = computers.find((c) => c.thisDevice);
		starter = self ?? {
			id: null,
			name: host.computer?.name ?? "this computer",
			online: true,
			lastSeenAt: null,
			thisDevice: true,
			projectIds: null,
		};
		starterIsHost = host.computer?.host.enabled === true;
	}
	const all = starter.id === null ? [starter, ...computers] : computers;
	return {
		starter,
		starterIsHost,
		computers,
		byName: (name) => all.find((c) => c.name === name) ?? null,
		byId: (id) => all.find((c) => c.id === id) ?? null,
	};
}

/** The Devices a flow names (`FlowListItem.devices`). */
export type FlowDeviceNames = {
	names: readonly string[];
	ids: readonly string[];
};

/** A computer the Space does not know now. */
const unknown = (name: string): Machine => ({
	id: null,
	name,
	online: null,
	lastSeenAt: null,
	thisDevice: false,
	projectIds: null,
});

/**
 * The computers a run needs, by name, in order: the one it runs on (the
 * schedule's device, else the starter; none for `null`), then the ones the
 * flow names. A profile's computer by id that the Space does not know shows
 * as "A device".
 */
export function neededMachines(
	machines: SpaceMachines,
	runsOn: string | undefined | null,
	flow: FlowDeviceNames | undefined,
): Machine[] {
	const out = new Map<string, Machine>();
	const add = (machine: Machine) => {
		if (!out.has(machine.name)) out.set(machine.name, machine);
	};
	if (runsOn !== null) {
		add(
			runsOn === undefined
				? machines.starter
				: (machines.byName(runsOn) ?? unknown(runsOn)),
		);
	}
	for (const name of flow?.names ?? []) {
		add(machines.byName(name) ?? unknown(name));
	}
	for (const id of flow?.ids ?? []) {
		add(machines.byId(id) ?? unknown("A device"));
	}
	return [...out.values()];
}
