import { useOpenGates } from "@/features/gates";
import type { DashboardSummary, NightRange, Project } from "@/shared/api";
import type { Metric } from "./metrics";
import { NeededYouDialog } from "./needed-you-dialog";
import { RunsDialog } from "./runs-dialog";
import { SpendDialog } from "./spend-dialog";

/**
 * The details of a number, at the page's range: Runs and Finished open the
 * runs (Finished on the failed ones), Spend and Needed you their own.
 * Without a project, over every project.
 */
export function MetricDetails({
	metric,
	open,
	onOpenChange,
	project,
	summary,
	range,
}: {
	metric: Metric;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	project?: Project;
	summary: DashboardSummary;
	range: NightRange;
}) {
	const gates = useOpenGates();
	const props = {
		open,
		onOpenChange,
		summary,
		project,
		initialRange: range,
	};

	if (metric === "spend") return <SpendDialog {...props} />;
	if (metric === "needed") {
		return (
			<NeededYouDialog
				{...props}
				gates={
					gates.data?.filter(
						(gate) => !project || gate.projectId === project.id,
					) ?? []
				}
			/>
		);
	}
	return (
		<RunsDialog
			{...props}
			initialTab={metric === "finished" ? "failed" : "overview"}
		/>
	);
}
