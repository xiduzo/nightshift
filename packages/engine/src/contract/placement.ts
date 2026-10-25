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
	 * Another Person's Device: the profiles it offers to the Space, the
	 * only ones a run there may use. Absent for the Person's own Devices.
	 */
	offers?: string[];
};

/**
 * A node, as far as the choice of its Device goes: the profile of an
 * Agent node, or none (a node that runs nothing offered).
 */
export type NodeToPlace = { profile?: string };

/** One of a Person's Devices, as placement sees it. */
export type OwnDevice = Placement & {
	/** It takes work now. */
	online: boolean;
	/** It has a Clone of the project. */
	hasClone: boolean;
};
