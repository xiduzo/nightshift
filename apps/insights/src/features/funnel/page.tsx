import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/api";
import { count, duration } from "@/shared/format";
import {
	Columns,
	EmptyNote,
	LoadState,
	Page,
	Section,
	Stat,
	Stats,
} from "@/shared/page";

const STEP_LABEL = {
	install: "Install",
	agent: "Agent",
	project: "Project",
	checked: "Project check",
	flow: "Flow",
	schedule: "Schedule",
	run: "First run",
	finished: "Finished run",
	useful: "Useful run",
} as const;

/** The setup funnel, the time between steps, and where installs stop. */
export function FunnelPage() {
	const query = useQuery(orpc.funnel.queryOptions({ input: {} }));
	const data = query.data;
	const stopped = data?.steps.find((step) => step.stopped > 0);
	return (
		<Page
			title="Funnel"
			detail="See each step from install to a run that a person found useful."
		>
			<LoadState pending={query.isPending} error={query.isError}>
				{data ? (
					<>
						<Stats>
							<Stat
								label="Time to a finished run"
								value={duration(data.medianSecondsToFirstFinishedRun)}
							/>
							<Stat
								label="Time to a useful run"
								value={duration(data.medianSecondsToFirstUsefulRun)}
							/>
						</Stats>
						<Section title="Steps">
							<p className="text-muted-foreground text-sm">
								The time is the median between steps.
							</p>
							{data.steps.length === 0 ? (
								<EmptyNote title="No install is recorded yet." />
							) : (
								<Columns
									headers={[
										"Step",
										"Installs",
										"Stopped",
										"From install",
										"From the previous step",
									]}
									rows={data.steps.map((step) => [
										STEP_LABEL[step.step],
										count(step.installs),
										count(step.stopped),
										duration(step.medianSecondsFromInstall),
										duration(step.medianSecondsFromPrevious),
									])}
								/>
							)}
						</Section>
						<Section title="Where installs stop">
							<p className="text-muted-foreground text-sm">
								Stopped means the next step never happens.
							</p>
							<p>
								{stopped
									? `Most installs stop at ${STEP_LABEL[stopped.step]}.`
									: "No install has stopped yet."}
							</p>
						</Section>
					</>
				) : null}
			</LoadState>
		</Page>
	);
}
