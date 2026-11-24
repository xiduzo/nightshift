import { type Flow, readFlow } from "../../../flow";
import { starterList } from "../../../starters";
import { type FlowAgent, flowAgents } from "./flow-agents";

/**
 * The agents the starters name, each once. Adding the starters to a
 * project asks which of the person's profiles takes each one.
 */
export function starterAgents(): FlowAgent[] {
	const flows = starterList().flatMap((starter): Flow[] => {
		const { flow } = readFlow(starter.source);
		return flow ? [flow] : [];
	});
	return flowAgents(flows);
}
