/** The run log: the one door to a run's facts. It appends each event with the rows the event implies, and it stamps the first event of a Command. */

export { asCommand } from "./command-stamp";
export {
	createRunLog,
	type Derive,
	type ForeignEvent,
	type RunLog,
} from "./run-log";
