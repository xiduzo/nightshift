/** Work on another Device: a Device through a Host (`remoteDevice`), the Host's hub, and the placed Device's server. */

export { remoteDevice } from "./remote";
export { serveWork } from "./serve-work";
export { createWorkServer, type ServedCalls, servedCalls } from "./work";
export { createWorkHub, type WorkHub } from "./work-hub";
