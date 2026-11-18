/** Where the run is: the step the Checkpoint holds for a node, the visits, and the step the log has that the Checkpoint lost. */

export {
	commitVisit,
	type DoneStep,
	heldStep,
	holdEnded,
	isCutShort,
	isDone,
	latestFront,
	loggedVisits,
	positionOf,
	reenteredNode,
	takeBackVisit,
} from "./run-position";
