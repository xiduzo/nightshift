import { inMemoryAccess } from "../../../access/adapters/out/in-memory-access";
import {
	answerCostRecords,
	inMemoryAnswerCostStore,
} from "./in-memory-answer-cost-store";

/**
 * `inMemoryAssistantPorts`, which gives a use-case test every port of the
 * use cases at once, on the records of one Replica. Test code: production
 * code never imports this file.
 */

/** Every port of assistant in memory at once: where each use-case test starts. */
export function inMemoryAssistantPorts() {
	const records = answerCostRecords();
	let keys = 0;
	return {
		access: inMemoryAccess(),
		records,
		answerCostStore: inMemoryAnswerCostStore(records),
		newKey: () => `key-${++keys}`,
	};
}
