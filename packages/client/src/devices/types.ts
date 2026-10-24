import type { ApiOutputs } from "../api";

/** The Devices page: this computer, its Hosts, and the Person's paired Devices. */
export type DevicesOverview = ApiOutputs["devices"]["list"];
export type ThisComputer = NonNullable<DevicesOverview["thisComputer"]>;
export type LinkedHost = ThisComputer["hosts"][number];
export type PairedDevice = DevicesOverview["devices"][number];
export type PairingReview = ApiOutputs["devices"]["review"];
export type OfferView = ApiOutputs["offers"]["list"]["offers"][number];
export type SpaceDevice = ApiOutputs["devices"]["space"][number];
/** A phone signed in to the Host of the Space, as its Person. */
export type Phone = ApiOutputs["devices"]["phones"][number];
