import { flowNameSchema, suffixedName } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
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
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CopyIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { projectQueries } from "@/features/projects";
import { flowMutations, flowQueries } from "../queries";

/**
 * Copies a flow into another project of the Space. The flows it calls stay
 * here: the copy shows them as errors until that project has them too.
 */
export function CopyFlowDialog({
	open,
	onOpenChange,
	projectId,
	name,
	dirty,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	name: string;
	/** The draft has changes that are not saved: the copy is of the saved flow. */
	dirty: boolean;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{open ? (
					<CopyFlowForm
						projectId={projectId}
						name={name}
						dirty={dirty}
						onDone={() => onOpenChange(false)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function CopyFlowForm({
	projectId,
	name,
	dirty,
	onDone,
}: {
	projectId: string;
	name: string;
	dirty: boolean;
	onDone: () => void;
}) {
	const id = useId();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const projects = useQuery(projectQueries.list());
	const targets = (projects.data ?? [])
		.filter((project) => project.id !== projectId)
		.map((project) => ({ value: project.id, label: project.name }));
	const [targetId, setTargetId] = useState<string | null>(null);
	const target = targets.find((t) => t.value === targetId);
	const targetFlows = useQuery({
		...flowQueries.list(targetId ?? ""),
		enabled: targetId !== null,
	});
	const taken = new Set(targetFlows.data?.map((flow) => flow.name) ?? []);
	// Until the person types a name: the flow's own, or the first free one there.
	const [typed, setTyped] = useState<string | null>(null);
	const copyName = typed ?? suffixedName(name, taken);
	const trimmed = copyName.trim();
	const parsed = flowNameSchema.safeParse(trimmed);
	const nameError =
		trimmed === ""
			? "Give the copy a name."
			: !parsed.success
				? (parsed.error.issues[0]?.message ?? "Not a valid name.")
				: taken.has(trimmed)
					? `That project has a flow named ${trimmed}. Try ${suffixedName(trimmed, taken)}.`
					: null;

	const copy = useMutation(
		flowMutations.copy({
			onSuccess: (saved, input) => {
				void queryClient.invalidateQueries({ queryKey: flowQueries.lists() });
				const errors = saved.issues.filter(
					(issue) => issue.severity === "error",
				).length;
				const open = {
					label: "Open",
					onClick: () =>
						void navigate({
							to: "/projects/$projectId/flows/$name",
							params: { projectId: input.toProjectId, name: saved.name },
						}),
				};
				const where = `${target?.label ?? "the project"} as ${saved.name}`;
				if (errors > 0) {
					toast.warning(
						`Copied into ${where}. Fix its ${errors} ${errors === 1 ? "error" : "errors"} there before you run it.`,
						{ action: open },
					);
				} else {
					toast.success(`Copied into ${where}`, { action: open });
				}
				onDone();
			},
		}),
	);
	const canCopy =
		targetId !== null &&
		targetFlows.isSuccess &&
		nameError === null &&
		!copy.isPending;

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (!canCopy || targetId === null) return;
				copy.mutate({ projectId, name, toProjectId: targetId, as: trimmed });
			}}
		>
			<DialogHeader>
				<DialogTitle>Copy {name} into a project</DialogTitle>
				<DialogDescription>
					The copy is a flow of its own there. The flows that this flow calls
					stay here.
					{dirty
						? " Night Shift copies the saved flow, without your unsaved changes."
						: ""}
				</DialogDescription>
			</DialogHeader>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor={`${id}-project`}>Project</FieldLabel>
					<Select
						items={targets}
						value={targetId}
						onValueChange={(value) => setTargetId(value)}
						disabled={targets.length === 0}
					>
						<SelectTrigger id={`${id}-project`} className="w-full">
							<SelectValue placeholder="Choose a project" />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{targets.map((t) => (
									<SelectItem key={t.value} value={t.value}>
										{t.label}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
					{targets.length === 0 && !projects.isLoading ? (
						<FieldDescription>
							This Space has no other project. Add one first.
						</FieldDescription>
					) : null}
				</Field>
				<Field
					data-invalid={
						(targetId !== null && nameError !== null) || copy.error
							? true
							: undefined
					}
				>
					<FieldLabel htmlFor={`${id}-name`}>Name of the copy</FieldLabel>
					<Input
						id={`${id}-name`}
						value={copyName}
						onChange={(event) => setTyped(event.target.value)}
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
						aria-invalid={targetId !== null && nameError !== null}
						aria-describedby={`${id}-hint`}
					/>
					{copy.error ? (
						<FieldError id={`${id}-hint`}>{copy.error.message}</FieldError>
					) : targetId !== null && nameError !== null ? (
						<FieldError id={`${id}-hint`}>{nameError}</FieldError>
					) : (
						<FieldDescription id={`${id}-hint`}>
							Use lowercase letters, digits and dashes.
						</FieldDescription>
					)}
				</Field>
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={!canCopy}>
					{copy.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<CopyIcon data-icon="inline-start" />
					)}
					{copy.isPending ? "Copying…" : "Copy into project"}
				</Button>
			</DialogFooter>
		</form>
	);
}
