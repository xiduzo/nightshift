/** The runs of this computer as spans and metric points, projected from the landed facts: the rules alone. The composition (`wire.ts`) writes them to the export. */

export { assertConforms } from "./domain/conform";
export {
	INSTRUMENTS,
	type InstrumentName,
	type RunRecord,
	type SpanKey,
} from "./domain/run-record";
export { recordsOf } from "./domain/run-records";
