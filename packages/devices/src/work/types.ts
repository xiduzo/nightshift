import type { WorkRequest } from "./remote";

/** What a placed Device takes from its Host: a call to serve, or one to cancel. */
export type WorkDelivery =
	| { kind: "call"; id: string; request: WorkRequest }
	| { kind: "cancel"; id: string };
