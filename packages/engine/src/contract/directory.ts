/**
 * What the engine reads of the Device rows (`DeviceDirectory`): this
 * computer's Device, the names of Devices, and the Spaces a Host keeps.
 * The `device` and `host_space` tables belong to `@nightshift/devices`,
 * which implements this port (`deviceDirectory`). The engine never queries
 * them. The Space documents need it before the engine and its `Peers`
 * exist, so the daemon makes it first and gives it to both. The engine's
 * own tests use `aloneDirectory` (`./testing`).
 */
export type DeviceDirectory = {
	/**
	 * This computer's Device id: the Walker of its runs. Made when the
	 * database has no Device of its own yet.
	 */
	selfId(): Promise<string>;
	/** The Person who owns this computer's Device, or null before one does. */
	selfOwnerId(): Promise<string | null>;
	/** The names of the Devices with these ids. A Device without a row has no entry. */
	names(ids: readonly string[]): Promise<Map<string, string>>;
	/** Whether a Host keeps the Space, not this Replica. */
	hostedElsewhere(spaceId: string): Promise<boolean>;
};
