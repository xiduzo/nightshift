import {
	type FlowAgent,
	flowAgents,
	flowNameOfFile,
	parseFlow,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { FlowAgentsStep, useFlowAgents } from "@/features/agents";
import { flowMutations } from "../queries";

/** A file the person chose, before Night Shift saves it. */
type ChosenFile = { name: string; json: string; agents: FlowAgent[] };

/** The agents the flow of a file names. None when it is not a flow: the import says why. */
function agentsOf(json: string): FlowAgent[] {
	try {
		const { flow } = parseFlow(JSON.parse(json));
		return flow ? flowAgents([flow]) : [];
	} catch {
		return [];
	}
}

/**
 * Imports a flow file, one that Night Shift exported, as a new flow of the
 * project. Its name comes from the file name, with a suffix when the
 * project has that name already. A flow that names agents asks first
 * which of your profiles takes each one.
 */
export function ImportFlowButton({ projectId }: { projectId: string }) {
	const input = useRef<HTMLInputElement>(null);
	const navigate = useNavigate();
	const [chosen, setChosen] = useState<ChosenFile | null>(null);
	const importFlow = useMutation(
		flowMutations.import({
			onSuccess: (saved) => {
				setChosen(null);
				const errors = saved.issues.filter(
					(issue) => issue.severity === "error",
				).length;
				const open = {
					label: "Open",
					onClick: () =>
						void navigate({
							to: "/projects/$projectId/flows/$name",
							params: { projectId, name: saved.name },
						}),
				};
				if (errors > 0) {
					toast.warning(
						`Imported ${saved.name}. Fix its ${errors} ${errors === 1 ? "error" : "errors"} before you run it.`,
						{ action: open },
					);
				} else {
					toast.success(`Imported ${saved.name}`, { action: open });
				}
			},
			onError: (error) => toast.error(`Could not import: ${error.message}`),
		}),
	);

	return (
		<>
			<Button
				variant="outline"
				size="sm"
				disabled={importFlow.isPending}
				onClick={() => input.current?.click()}
			>
				{importFlow.isPending ? (
					<Spinner data-icon="inline-start" />
				) : (
					<UploadIcon data-icon="inline-start" />
				)}
				Import flow
			</Button>
			<input
				ref={input}
				type="file"
				accept=".json,application/json"
				className="sr-only"
				tabIndex={-1}
				aria-hidden="true"
				onChange={async (event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (!file) return;
					const json = await file.text();
					const name = flowNameOfFile(file.name);
					const agents = agentsOf(json);
					if (agents.length === 0) importFlow.mutate({ projectId, name, json });
					else setChosen({ name, json, agents });
				}}
			/>
			<Dialog
				open={chosen !== null}
				onOpenChange={(open) => {
					if (!open) setChosen(null);
				}}
			>
				<DialogContent className="sm:max-w-md">
					{chosen ? (
						<ImportFlowForm
							file={chosen}
							busy={importFlow.isPending}
							onImport={(agents) =>
								importFlow.mutate({
									projectId,
									name: chosen.name,
									json: chosen.json,
									agents,
								})
							}
						/>
					) : null}
				</DialogContent>
			</Dialog>
		</>
	);
}

/** The agents step of an import: which of your profiles takes each agent of the file's flow. */
function ImportFlowForm({
	file,
	busy,
	onImport,
}: {
	file: ChosenFile;
	busy: boolean;
	onImport: (agents: ReturnType<typeof useFlowAgents>["choices"]) => void;
}) {
	const step = useFlowAgents(file.agents);
	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				onImport(step.choices);
			}}
		>
			<DialogHeader>
				<DialogTitle>
					Import <span className="font-mono">{file.name}</span>
				</DialogTitle>
			</DialogHeader>
			<FlowAgentsStep step={step} />
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={busy || step.loading}>
					{busy ? (
						<Spinner data-icon="inline-start" />
					) : (
						<UploadIcon data-icon="inline-start" />
					)}
					{busy ? "Importing…" : "Import flow"}
				</Button>
			</DialogFooter>
		</form>
	);
}
