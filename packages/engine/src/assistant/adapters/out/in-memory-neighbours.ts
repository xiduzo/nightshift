import { inMemoryAccess } from "../../../access/adapters/out/in-memory-access";
import { inMemoryAnswerCostStore } from "./in-memory-answer-cost-store";

/**
 * `inMemoryAssistantPorts`, which gives a use-case test every port of the
 * use cases at once. Test code: production
 * code never imports this file.
 */

/** Every port of assistant in memory at once: where each use-case test starts. */
export function inMemoryAssistantPorts() {
	let keys = 0;
	return {
		access: inMemoryAccess(),
		answerCostStore: inMemoryAnswerCostStore(),
		newKey: () => `key-${++keys}`,
	};
}
