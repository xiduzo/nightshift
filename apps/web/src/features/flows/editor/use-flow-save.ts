// Saving the draft, and the export of the saved flow.

import type { Flow, FlowIssue } from "@nightshift/flows";
import type { QueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { saveFile } from "../move";
import { flowMutations, flowQueries } from "../queries";
import type { EditingSession } from "./session";

/**
 * Saving the draft: the save request, `save` (it saves a draft that
 * changed and is valid), what follows a save, and the export of the
 * saved flow as a file.
 */
export function useFlowSave({
	session,
	queryClient,
	projectId,
	name,
	draft,
	dirty,
	savable,
}: {
	session: EditingSession;
	queryClient: QueryClient;
	projectId: string;
	name: string;
	draft: Flow;
	dirty: boolean;
	savable: boolean;
}) {
	const saveFlow = useMutation(
		flowMutations.save({
			onError: (error) => toast.error(`Could not save: ${error.message}`),
		}),
	);

	const canSave = dirty && savable && !saveFlow.isPending;

	const exportFlow = async () => {
		try {
			const file = await queryClient.fetchQuery(
				flowQueries.export(projectId, name),
			);
			saveFile(file.fileName, file.json);
			if (dirty) {
				toast.info(
					"Exported the saved flow. Save first to export your changes too.",
				);
			}
		} catch (error) {
			toast.error(
				`Could not export: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	/** After a save: the draft is the file now, and the cached flow follows. */
	const onSaved = useCallback(
		(snapshot: Flow, issues: FlowIssue[]) => {
			session.saved(snapshot);
			queryClient.setQueryData(
				flowQueries.get(projectId, name).queryKey,
				(loaded) => (loaded ? { ...loaded, flow: snapshot, issues } : loaded),
			);
			// The live cache reads the lists, the map and the revisions.
		},
		[session, queryClient, projectId, name],
	);

	const save = useCallback(() => {
		if (!canSave) return;
		const snapshot = draft;
		saveFlow.mutate(
			{ projectId, name, flow: snapshot },
			{
				onSuccess: (issues) => {
					onSaved(snapshot, issues);
					const errors = issues.filter(
						(issue) => issue.severity === "error",
					).length;
					if (errors > 0) {
						toast.warning(
							`Saved with ${errors} ${errors === 1 ? "error" : "errors"}. Fix them before you run the flow.`,
						);
					} else {
						toast.success("Flow saved");
					}
				},
			},
		);
	}, [canSave, saveFlow, projectId, name, draft, onSaved]);
	return { saveFlow, exportFlow, onSaved, save };
}
