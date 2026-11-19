import { Refusal } from "@nightshift/refusal";
import type { StartRunInput } from "../../../contract";
import type { RunSummary } from "../../../read";
import { resolvePins } from "../domain/test-run";
import type { HostStarts, NewRuns } from "./ports";

export type StartRunOnHostPorts = {
	runs: Pick<NewRuns, "pinned">;
	hosts: HostStarts;
};

/** A start the Host that keeps the Space walks: the Space, and what it starts. */
export type StartRunOnHost = {
	spaceId: string;
	input: StartRunInput;
};

/** What a person reads when the Host started the run, but it has not reached this Replica in time. */
const NOT_ARRIVED_YET =
	"The run started. It shows in the run list in a moment.";

/**
 * Has the Host of the Space start a run: the Host walks it. Returns once
 * the run reached this Replica, as the run list shows it.
 *
 * A test run's pins travel as refs (ADR 27): the Host reads their outputs
 * from its own log. This computer reads them from its own log first, so a
 * pin it cannot use is refused in the words of a run it walks itself, and
 * the Host refuses only a run that has not reached it yet. A start that
 * pins and skips nothing is no test run.
 */
export const startRunOnHost =
	(ports: StartRunOnHostPorts) =>
	async (request: StartRunOnHost): Promise<RunSummary> => {
		const { spaceId, input } = request;
		const test = await resolvePins(
			input.test,
			{ id: input.projectId, spaceId },
			(runId) => ports.runs.pinned(runId),
		);
		const start =
			test === null && input.test !== undefined
				? { ...input, test: undefined }
				: input;
		const { runId } = await ports.hosts.start({ ...start, spaceId });
		const summary = await ports.hosts.arrived({
			runId,
			spaceId,
			projectId: input.projectId,
		});
		if (summary) return summary;
		throw new Refusal("unavailable", NOT_ARRIVED_YET);
	};
