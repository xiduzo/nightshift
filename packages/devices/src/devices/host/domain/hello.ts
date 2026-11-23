/**
 * What a paired Device learns when its link answers: its owner's Spaces
 * on this Host, and on a home Host the Devices whose documents it reads.
 */

/** A Space as hello lists it: personal stays with the home Host (ADR 1). */
export type HelloSpace = { personal: boolean };

/**
 * A Guest Host lists no personal Space. A home Device gets every Space
 * of its owner.
 */
export function spacesForHello<T extends HelloSpace>(
	spaces: readonly T[],
	home: boolean,
): T[] {
	return home ? [...spaces] : spaces.filter((space) => !space.personal);
}

/** Another Device of the owner whose document this Host keeps. */
export type OwnDevice = {
	id: string;
	name: string;
	revokedAt: number | null;
	homeHost: string | null;
};

/**
 * The Devices a home Device reads (`documentAccess`): the owner's other
 * Devices whose home this Host is, and this Host when the owner owns it.
 * Never another Person's. Never a Device whose access is gone.
 */
export function ownDevicesForHello(
	others: readonly OwnDevice[],
	self: { id: string; name: string },
	ownerOwnsHost: boolean,
	deviceId: string,
): { id: string; name: string }[] {
	const host = ownerOwnsHost ? [{ id: self.id, name: self.name }] : [];
	const listed = others
		.filter(
			(d) => d.id !== deviceId && d.revokedAt === null && d.homeHost !== null,
		)
		.map((d) => ({ id: d.id, name: d.name }));
	return [...host, ...listed];
}

/** Whether this Host is the Device's home Host. */
export function isHomeDevice(homeHost: string | null): boolean {
	return homeHost !== null;
}
