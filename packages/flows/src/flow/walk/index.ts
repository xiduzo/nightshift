/** The walk from node to node: the edge a run takes after an outcome, and the shape of a fan-out. */

export {
	type BranchPlace,
	branchPlaces,
	type FanOut,
	fanOutsOf,
} from "./branches";
export { type NextEdge, type NextEdgeInput, nextEdge } from "./walk";
