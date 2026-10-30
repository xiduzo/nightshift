import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Checkbox } from "@nightshift/ui/components/checkbox";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, MergeIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { MergePreviewList } from "./merge-preview";
import { mergeQueries } from "./queries";

/**
 * A computer that joined its home Host before Night Shift merged the
 * personal Spaces keeps its own Personal beside the Host's. This banner
 * offers the merge. It never merges by itself: the person reads what
 * moves, and confirms it.
 */
export function MergePersonalAlert() {
	const pending = useQuery(mergeQueries.pending());
	const [open, setOpen] = useState(false);
	if (!pending.data?.pending) return null;
	const { hostName, blocked, state } = pending.data;
	const host = hostName ?? "your home Host";
	return (
		<div className="mx-auto w-full max-w-6xl px-4 pt-8 md:px-8">
			<Alert>
				<MergeIcon />
				<AlertTitle>
					{state ? "Finish merging your Personal" : "Make one Personal"}
				</AlertTitle>
				<AlertDescription>
					{blocked ??
						(state
							? "A merge of your Personal stopped before the end. Finish it now."
							: `This computer has its own Personal beside your Personal on ${host}. Merge them to see all your projects and runs in one place, on every device.`)}
				</AlertDescription>
				<AlertAction>
					<Button
						size="sm"
						disabled={blocked !== null}
						onClick={() => setOpen(true)}
					>
						{state ? "Finish the merge" : "Review the merge"}
					</Button>
				</AlertAction>
			</Alert>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-lg">
					{open ? (
						<MergeSteps
							host={host}
							resume={state !== null}
							onDone={() => setOpen(false)}
						/>
					) : null}
				</DialogContent>
			</Dialog>
		</div>
	);
}

/** What moves, the projects a shared Space could take, and the confirmation. */
function MergeSteps({
	host,
	resume,
	onDone,
}: {
	host: string;
	resume: boolean;
	onDone: () => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const [join, setJoin] = useState<string[]>([]);
	// A merge that stopped goes on as it was confirmed: no new preview.
	const preview = useQuery({
		...mergeQueries.preview(join),
		enabled: !resume,
		placeholderData: (previous) => previous,
	});
	const merge = useMutation({
		...mergeQueries.run(),
		onSuccess: (result) => {
			// Personal is one Space now: every list reads again.
			void queryClient.invalidateQueries();
			toast.success(
				result.state === "pushed"
					? "Your Personal is merged"
					: `Your Personal is merged. Your runs reach ${host} as soon as it answers.`,
			);
			onDone();
		},
	});
	const choices = (preview.data?.projects ?? []).filter(
		(project) => project.sharedSpace !== null,
	);

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{resume ? "Finish merging your Personal" : "Merge your Personal"}
				</DialogTitle>
				<DialogDescription>
					{resume
						? `Night Shift moves the rest of your Personal into your Personal on ${host}.`
						: `Your projects and runs on this computer move into your Personal on ${host}. Night Shift keeps a copy of your data from before the merge.`}
				</DialogDescription>
			</DialogHeader>
			{resume ? null : preview.error ? (
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertTitle>Night Shift cannot merge now</AlertTitle>
					<AlertDescription>{preview.error.message}</AlertDescription>
				</Alert>
			) : preview.data ? (
				<FieldGroup>
					<MergePreviewList preview={preview.data} />
					{choices.length > 0 ? (
						<FieldSet>
							<FieldLegend variant="label">Shared projects</FieldLegend>
							<FieldDescription>
								A shared Space has a project with the same repository. Choose
								one to move your runs there. Its members then see them.
							</FieldDescription>
							{choices.map((project) => (
								<Field key={project.id} orientation="horizontal">
									<Checkbox
										id={`${id}-${project.id}`}
										checked={join.includes(project.id)}
										onCheckedChange={(checked) =>
											setJoin((now) =>
												checked === true
													? [...now, project.id]
													: now.filter((p) => p !== project.id),
											)
										}
									/>
									<FieldLabel htmlFor={`${id}-${project.id}`}>
										Move {project.name} into {project.sharedSpace?.name}
									</FieldLabel>
								</Field>
							))}
						</FieldSet>
					) : null}
				</FieldGroup>
			) : (
				<div className="flex flex-col gap-2" aria-hidden>
					<Skeleton className="h-14 w-full" />
					<Skeleton className="h-14 w-full" />
				</div>
			)}
			{merge.error ? (
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertTitle>The merge stopped</AlertTitle>
					<AlertDescription>
						{merge.error.message} Nothing is lost. Try again.
					</AlertDescription>
				</Alert>
			) : null}
			<DialogFooter>
				<DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
				<Button
					disabled={merge.isPending || (!resume && !preview.data)}
					onClick={() => merge.mutate({ join })}
				>
					{merge.isPending ? <Spinner data-icon="inline-start" /> : null}
					{resume ? "Finish the merge" : "Merge Personal"}
				</Button>
			</DialogFooter>
		</>
	);
}
