/** Where a visit goes next: the route on the end of a step, the park of a run, and the interrupt a graph node waits at. */

export { askAgain, gateNode, interruptNode, openAgain } from "./interrupt";
export {
	askNodeId,
	isInterruptNode,
	parkCommand,
	parkFailed,
	parkNode,
	parkNodeId,
	parkStopped,
	route,
	routeDone,
	type StepEnd,
	scopeOf,
	waitNodeId,
} from "./route";
