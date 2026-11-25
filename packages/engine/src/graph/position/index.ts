/** Where the run is: the step the Checkpoint holds for a node, the visits, and the step the log has that the Checkpoint lost. */

export {
	commitVisit,
	type DoneStep,
	heldStep,
	holdEnded,
	isCutShort,
	latestFront,
	loggedVisits,
	positionOf,
	reenteredNode,
	takeBackVisit,
	takenUp,
} from "./run-position";
