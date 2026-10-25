/** Work on another Device: a Device through a Host (`remoteDevice`), the Host's hub, and the placed Device's server. */

export { remoteDevice } from "./remote";
export {
	createOfferCalls,
	createWorkServer,
	type OfferDeps,
	type ServedCalls,
	serveChecked,
	servedCalls,
} from "./work";
export { createWorkHub, type WorkHub } from "./work-hub";
