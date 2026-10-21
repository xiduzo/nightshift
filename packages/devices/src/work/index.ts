/** Work on another Device: a Device through a Host (`remoteDevice`), the Host's hub, and the placed Device's server. */

export {
	remoteDevice,
	type WorkCall,
	type WorkRelay,
	type WorkReply,
	type WorkRequest,
	workReplySchema,
	workRequestSchema,
} from "./remote";
export type { WorkDelivery } from "./types";
export {
	createOfferCalls,
	createWorkServer,
	type OfferDeps,
	serveChecked,
	type WorkServer,
} from "./work";
export { createWorkHub, type WorkHub } from "./work-hub";
