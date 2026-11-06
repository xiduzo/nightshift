import type { DeviceKeyAccess, Permissions, Role } from "@nightshift/auth";

/**
 * A paired Device calling this Host, as the Host admitted it once for
 * this call: its Device key (`DeviceKeyAccess`), its Device as this Host
 * paired it, and its Person's role in the Spaces it asks about.
 *
 * The implementation of every keyed procedure takes it in place of the
 * key. Before the call reached it, the Host resolved what the contract's
 * meta asks: this computer is a Host, the key holds the permission, and
 * the Device is paired here, with access, as the key's Person's own
 * (`Devices.admit`). An implementation adds only what its procedure
 * asks of the Space: a role (`may`), a Membership (`member`).
 */
export type Caller = DeviceKeyAccess & {
	/** The Device as this Host paired it. */
	readonly device: {
		readonly name: string;
		/** The address it joined by, when this Host is its home Host. Null: a guest Host. */
		readonly homeHost: string | null;
	};
	/** The ids of the Spaces its Person is a Member of, read now: a long call sees a change. */
	spaces(): Promise<string[]>;
	/** Its Person's role in a Space, read once per call. Null: not a Member. */
	roleIn(spaceId: string): Promise<Role | null>;
	/** Whether its Person is a Member of the Space. */
	member(spaceId: string): Promise<boolean>;
	/**
	 * Refuses (FORBIDDEN, with `words` or the role refusal's own) unless its
	 * Person's role in the Space allows `need`. Not a Member: refused the same.
	 */
	may(spaceId: string, need: Permissions, words?: string): Promise<void>;
};
