/**
 * A Device a run of a project can be placed on, online, with a Clone of
 * the project: one of the Person's own, or another Person's that offers
 * profiles to the Space.
 */
export type Placement = {
	deviceId: string;
	name: string;
	/** This computer. */
	thisDevice: boolean;
	/**
	 * Another Person's Device: the names of the profiles it offers to the
	 * Space, the only ones a run there may use. Absent for the Person's
	 * own Devices.
	 */
	offers?: string[];
	/**
	 * The project's latest run ran on it: where a run goes by default when
	 * this computer has no Clone of the project. Absent on the others.
	 */
	lastRun?: boolean;
};

/**
 * A node, as far as the choice of its Device goes: the profile of an
 * Agent node, or none (a node that runs nothing offered).
 */
export type NodeToPlace = { profile?: string };

/**
 * A profile of a Device, as a Person picks it for a node: its id, its
 * name, and its kind (an Agent Profile for Agent nodes, a Model Profile
 * for Decisions and Values decided by a model).
 */
export type DeviceProfile = {
	id: string;
	name: string;
	kind: "agent" | "model";
};

/** One of a Person's Devices, as placement sees it. */
export type OwnDevice = Omit<Placement, "lastRun"> & {
	/** It takes work now. */
	online: boolean;
	/** It has a Clone of the project. */
	hasClone: boolean;
	/**
	 * The profiles a run of the Person may use on it: every profile of
	 * their own Device, the offered ones of another Person's. Absent when
	 * this computer cannot tell: it has no copy of that Device's document.
	 */
	profiles?: DeviceProfile[];
};
