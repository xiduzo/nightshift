/** Work on another Device: a Device through a Host (`remoteDevice`), the Host's hub, and the placed Device's server. */

export { remoteDevice, serveWork } from "./remote";
export { createWorkServer, type ServedCalls, servedCalls } from "./work";
export { createWorkHub, type WorkHub } from "./work-hub";
