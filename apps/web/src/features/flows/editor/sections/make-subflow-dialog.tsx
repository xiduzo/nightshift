/**
 * "Make subflow from section": the person names the new flow and sees what
 * the change does before agreeing. What works differently comes first, in
 * an Alert. What blocks the change comes with what to change, and the
 * confirm button stays off. Confirming saves the new flow file at once and
 * puts the Subflow in this flow's draft, which the person saves as usual.
 */
import type { Flow, FlowSection, SubflowChange } from "@nightshift/flows";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
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
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import { BanIcon, SquareFunctionIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { flowMutations } from "../../queries";
import {
	groupSubflowChanges,
	makeSubflow,
	planSubflowDialog,
	projectFlowNames,
	type SubflowChangeGroups,
	type SubflowMade,
	subflowNameFor,
} from "./make-subflow";
import {
	type SubflowCopyContext,
	type SubflowText,
	subflowBlockerText,
	subflowChangeText,
} from "./make-subflow-copy";
import { sectionName } from "./section-problems";

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	/** The name of the flow open in the editor. */
	flowName: string;
	draft: Flow;
	section: FlowSection;
	/** The project's other flows. Undefined while they load. */
	flows: Readonly<Record<string, Flow | null>> | undefined;
	/** The new flow is saved: put `caller` in the draft. */
	onMade: (made: SubflowMade) => void;
};

export function MakeSubflowDialog({ open, onOpenChange, ...props }: Props) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
				{open ? (
					<MakeSubflowForm {...props} onClose={() => onOpenChange(false)} />
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** The headings of the groups of changes, in the order they show. */
const GROUPS: {
	key: Exclude<keyof SubflowChangeGroups, "differs">;
	title: string;
}[] = [
	{ key: "moves", title: "What moves" },
	{ key: "inputs", title: "What the new flow gets" },
	{ key: "outputs", title: "What comes back" },
	{ key: "exits", title: "How this flow continues" },
];

function MakeSubflowForm({
	projectId,
	flowName,
	draft,
	section,
	flows,
	onMade,
	onClose,
}: Omit<Props, "open" | "onOpenChange"> & { onClose: () => void }) {
	const id = useId();
	// Until the person types, the name follows the project's flows as they load.
	const [typed, setName] = useState<string | null>(null);
	const name =
		typed ??
		subflowNameFor(
			section,
			flows ? projectFlowNames(flows, flowName) : [flowName],
		);
	const trimmed = name.trim();
	const plan = useMemo(
		() =>
			flows === undefined
				? null
				: planSubflowDialog(draft, section.id, trimmed, { flows, flowName }),
		[draft, section.id, trimmed, flows, flowName],
	);
	const copy: SubflowCopyContext = { flow: draft };
	const groups = plan?.preview
		? groupSubflowChanges(plan.preview.changes)
		: null;

	const create = useMutation(flowMutations.save());
	const [failure, setFailure] = useState<string | null>(null);
	const ready = plan?.ready ?? null;
	const canConfirm = ready !== null && !create.isPending;

	const confirm = async () => {
		if (!ready || create.isPending) return;
		setFailure(null);
		const made = await makeSubflow(ready, (as, flow) =>
			create.mutateAsync({ projectId, name: as, flow }),
		);
		if (!made.ok) {
			setFailure(made.message);
			return;
		}
		onMade(made);
		onClose();
	};

	const nameError = plan?.nameProblem
		? subflowBlockerText(plan.nameProblem, copy).description
		: null;

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				void confirm();
			}}
		>
			<DialogHeader>
				<DialogTitle>Make a Subflow</DialogTitle>
				<DialogDescription>
					The nodes of the Section {sectionName(section)} move to a new flow. A
					Subflow runs it in their place. Night Shift saves the new flow now.
					You save this flow yourself.
				</DialogDescription>
			</DialogHeader>

			<Field data-invalid={nameError !== null || undefined}>
				<FieldLabel htmlFor={`${id}-name`}>Name of the new flow</FieldLabel>
				<Input
					id={`${id}-name`}
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="code-review"
					className="font-mono"
					autoComplete="off"
					spellCheck={false}
					aria-invalid={nameError !== null}
					aria-describedby={`${id}-hint`}
					autoFocus
					onFocus={(event) => event.currentTarget.select()}
				/>
				{nameError ? (
					<FieldError id={`${id}-hint`}>{nameError}</FieldError>
				) : (
					<FieldDescription id={`${id}-hint`}>
						Use lowercase letters, digits and dashes.
					</FieldDescription>
				)}
			</Field>

			{plan === null ? (
				<p className="flex items-center gap-2 text-muted-foreground text-sm">
					<Spinner />
					Loading the flows of this project…
				</p>
			) : null}

			{plan && plan.blockers.length > 0 ? (
				<Alert variant="destructive">
					<BanIcon />
					<AlertTitle>You cannot make this Subflow yet</AlertTitle>
					<AlertDescription>
						<TextList
							texts={plan.blockers.map((blocker) =>
								subflowBlockerText(blocker, copy),
							)}
						/>
					</AlertDescription>
				</Alert>
			) : null}

			{failure !== null ? (
				<Alert variant="destructive">
					<BanIcon />
					<AlertTitle>Could not save the new flow</AlertTitle>
					<AlertDescription>
						{failure} This flow did not change.
					</AlertDescription>
				</Alert>
			) : null}

			{groups && groups.differs.length > 0 ? (
				<Alert className="border-status-waiting/40 text-status-waiting">
					<TriangleAlertIcon />
					<AlertTitle>What works differently</AlertTitle>
					<AlertDescription>
						<TextList
							texts={groups.differs.map((change) =>
								subflowChangeText(change, copy),
							)}
						/>
					</AlertDescription>
				</Alert>
			) : null}

			{groups
				? GROUPS.map(({ key, title }) =>
						groups[key].length > 0 ? (
							<ChangeGroup
								key={key}
								title={title}
								changes={groups[key]}
								copy={copy}
							/>
						) : null,
					)
				: null}

			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={!canConfirm}>
					{create.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<SquareFunctionIcon data-icon="inline-start" />
					)}
					{create.isPending ? "Making…" : "Make subflow"}
				</Button>
			</DialogFooter>
		</form>
	);
}

/** A list of titles with their descriptions, inside an Alert. */
function TextList({ texts }: { texts: readonly SubflowText[] }) {
	return (
		<ul className="flex flex-col gap-2">
			{texts.map((text, index) => (
				// The same title can come twice ("A rule of …" for two nodes).
				<li key={`${text.title}:${index}`}>
					<span className="font-medium">{text.title}.</span> {text.description}
				</li>
			))}
		</ul>
	);
}

function ChangeGroup({
	title,
	changes,
	copy,
}: {
	title: string;
	changes: readonly SubflowChange[];
	copy: SubflowCopyContext;
}) {
	return (
		<section className="flex flex-col gap-2">
			<h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
				{title}
			</h3>
			<ItemGroup className="gap-1.5">
				{changes.map((change, index) => {
					const text = subflowChangeText(change, copy);
					return (
						<Item
							// Two changes can share a title (two outputs of one node).
							key={`${change.code}:${index}`}
							variant="outline"
							size="sm"
						>
							<ItemContent className="min-w-0">
								<ItemTitle className="line-clamp-none">{text.title}</ItemTitle>
								<ItemDescription className="line-clamp-none break-words">
									{text.description}
								</ItemDescription>
							</ItemContent>
						</Item>
					);
				})}
			</ItemGroup>
		</section>
	);
}
