import {
	type DeviceRef,
	deviceIdOf,
	legacyDeviceName,
} from "@nightshift/flows";
import type { SpaceComputer, SpaceView } from "./space-view";

/**
 * The computers a schedule or a flow needs, as the Space knows them now:
 * the one that starts its schedules (the Host, else this computer), and
 * every computer by its id, each with whether it is online. A schedule
 * and a node name a computer by id; its name is only what the page shows.
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
	/** A computer by its id, as a schedule, a node or a profile names it. */
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
	// A linked Host's own entry in the Space cannot tell if it is online: its link can.
	const all = [
		starter,
		...computers.filter((c) => !(starterIsHost && c.id === starter.id)),
	];
	return {
		starter,
		starterIsHost,
		computers,
		byId: (id) => all.find((c) => c.id === id) ?? null,
	};
}

/** The Devices a flow names, by id (`FlowListItem.devices`). */
export type FlowDeviceIds = { ids: readonly string[] };

/** What the page calls a computer a schedule names: its name, a name from before ids, or "another computer". */
export function machineName(
	machines: SpaceMachines | null | undefined,
	device: DeviceRef | undefined,
): string | undefined {
	if (device === undefined) return undefined;
	const id = deviceIdOf(device);
	return id === undefined
		? (legacyDeviceName(device) ?? undefined)
		: (machines?.byId(id)?.name ?? "another computer");
}

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
 * The computers a run needs, in order: the one it runs on (the schedule's
 * device, else the starter; none for `null`), then the ones the flow
 * names, each once, by id. A computer the Space does not know shows as
 * "A device", and a name from before ids as that name, without a status.
 */
export function neededMachines(
	machines: SpaceMachines,
	runsOn: DeviceRef | undefined | null,
	flow: FlowDeviceIds | undefined,
): Machine[] {
	const out = new Map<string, Machine>();
	const add = (key: string, machine: Machine) => {
		if (!out.has(key)) out.set(key, machine);
	};
	const byId = (id: string) => {
		const known = machines.byId(id);
		add(known?.id ?? id, known ?? unknown("A device"));
	};
	if (runsOn === undefined) {
		add(machines.starter.id ?? "starter", machines.starter);
	} else if (runsOn !== null) {
		const id = deviceIdOf(runsOn);
		if (id !== undefined) byId(id);
		else {
			const name = legacyDeviceName(runsOn) ?? "A device";
			add(`name:${name}`, unknown(name));
		}
	}
	for (const id of flow?.ids ?? []) byId(id);
	return [...out.values()];
}
