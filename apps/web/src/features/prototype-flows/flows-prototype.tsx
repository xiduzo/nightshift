/**
 * PROTOTYPE, throw away. The project's Flows page, four ways, switchable
 * through `?variant=` on the existing `/projects/$projectId/flows` route:
 * A a table like Runs and Schedules, B today's cards worked out further,
 * C a list of Items between the two, D today's cards. Round 1 also had a
 * page grouped by how flows start and a list with details (ef98015a).
 */

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nightshift/ui/components/alert-dialog";
import { Button } from "@nightshift/ui/components/button";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	FlowNotices,
	flowMutations,
	flowQueries,
	ImportFlowButton,
	NewFlowDialog,
	ProjectFlowsPage,
	StartRunDialog,
} from "@/features/flows";
import { ProjectPage } from "@/features/projects";
import { useNow } from "@/shared/format";
import { PageHeading } from "@/shared/page";
import { PrototypeSwitcher } from "@/shared/prototype-switcher";
import { type FlowRow, useFlowRows } from "./flows-data";
import { VariantCards } from "./variant-cards";
import { VariantItems } from "./variant-items";
import { VariantTable } from "./variant-table";

const VARIANTS = [
	{ key: "A", name: "Table, like Runs and Schedules" },
	{ key: "B", name: "Cards, worked out" },
	{ key: "C", name: "Items, between cards and table" },
	{ key: "D", name: "Today: cards" },
] as const;

/** What every variant gets: the rows, and the page's actions. */
export type VariantProps = {
	projectId: string;
	rows: FlowRow[] | undefined;
	error: Error | null;
	healthNights: number | undefined;
	now: number;
	onRun: (row: FlowRow) => void;
	onDelete: (row: FlowRow) => void;
	onNew: () => void;
};

export function FlowsPrototype({
	projectId,
	variant = "A",
}: {
	projectId: string;
	variant?: string;
}) {
	const switcher = <PrototypeSwitcher variants={VARIANTS} current={variant} />;
	if (variant === "D") {
		return (
			<>
				<ProjectFlowsPage projectId={projectId} />
				{switcher}
			</>
		);
	}
	return (
		<ProjectPage projectId={projectId} section="Flows">
			{(project) => (
				<>
					<FlowsPage projectId={project.id} variant={variant} />
					{switcher}
				</>
			)}
		</ProjectPage>
	);
}

function FlowsPage({
	projectId,
	variant,
}: {
	projectId: string;
	variant: string;
}) {
	const queryClient = useQueryClient();
	const now = useNow(30_000);
	const { rows, error, healthNights } = useFlowRows(projectId);
	const [creating, setCreating] = useState(false);
	const [toDelete, setToDelete] = useState<FlowRow | null>(null);
	// Kept after the dialog closes, so it does not empty while it fades.
	const [starting, setStarting] = useState<{
		row: FlowRow;
		open: boolean;
	} | null>(null);

	const removeFlow = useMutation(
		flowMutations.remove({
			onSuccess: (_, input) => {
				toast.success(`Deleted ${input.name}`);
				setToDelete(null);
				void queryClient.invalidateQueries({ queryKey: flowQueries.all() });
			},
			onError: (error) => toast.error(`Could not delete: ${error.message}`),
		}),
	);

	const props: VariantProps = {
		projectId,
		rows,
		error,
		healthNights,
		now,
		onRun: (row) => setStarting({ row, open: true }),
		onDelete: setToDelete,
		onNew: () => setCreating(true),
	};

	return (
		<section aria-labelledby="flows-heading" className="flex flex-col gap-4">
			<PageHeading
				id="flows-heading"
				title="Flows"
				description="The steps an agent follows. Run one, or open it to edit."
				actions={
					<>
						<ImportFlowButton projectId={projectId} />
						<Button
							variant="outline"
							size="sm"
							onClick={() => setCreating(true)}
						>
							<PlusIcon data-icon="inline-start" />
							New flow
						</Button>
					</>
				}
			/>
			<FlowNotices projectId={projectId} />

			{variant === "B" ? (
				<VariantCards {...props} />
			) : variant === "C" ? (
				<VariantItems {...props} />
			) : (
				<VariantTable {...props} />
			)}

			<NewFlowDialog
				open={creating}
				onOpenChange={setCreating}
				projectId={projectId}
				taken={rows?.map((row) => row.name) ?? []}
			/>
			{starting ? (
				<StartRunDialog
					open={starting.open}
					onOpenChange={(open) =>
						setStarting((current) => (current ? { ...current, open } : null))
					}
					projectId={projectId}
					flowName={starting.row.name}
					inputs={starting.row.flow.inputs}
				/>
			) : null}
			<AlertDialog
				open={toDelete !== null}
				onOpenChange={(open) => {
					if (!open) setToDelete(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {toDelete?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes the flow from the project. Its past runs stay as they
							are.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={removeFlow.isPending}
							onClick={() => {
								if (toDelete)
									removeFlow.mutate({ projectId, name: toDelete.name });
							}}
						>
							{removeFlow.isPending ? (
								<Spinner data-icon="inline-start" />
							) : null}
							{removeFlow.isPending ? "Deleting…" : "Delete flow"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}
