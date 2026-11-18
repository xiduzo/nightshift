import type { FlowInputDef } from "@nightshift/flows";
import { Dialog, DialogContent } from "@nightshift/ui/components/dialog";
import type { StartTest } from "./start-run-form";
import { StartRunForm } from "./start-run-form";

/**
 * Starts a flow file in a new worktree: its inputs, the ref to start from,
 * and an optional stop time. A project without a folder has no ref to
 * start from. With `test`, the editor's pins and skips: a test run, unless
 * the person turns them off.
 */
export function StartRunDialog({
	open,
	onOpenChange,
	projectId,
	flowName,
	inputs = [],
	test,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	flowName: string;
	/** The flow's inputs, asked before the start. */
	inputs?: FlowInputDef[];
	/** The editor's pins and skips. The Flows page never sends them. */
	test?: StartTest;
}) {
	// Inputs or pins to show: the wide, two-column layout of the quick run.
	const wide = inputs.length > 0 || test !== undefined;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className={
					wide
						? "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg md:max-w-3xl lg:max-w-5xl xl:max-w-6xl"
						: "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
				}
			>
				{open ? (
					<StartRunForm
						projectId={projectId}
						flowName={flowName}
						inputs={inputs}
						onStarted={() => onOpenChange(false)}
						test={test}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
