import { Button } from "@nightshift/ui/components/button";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { UploadIcon } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { flowMutations, flowQueries } from "../queries";
import { flowNameOfFile } from "./flow-file";

/**
 * Imports a flow file, one that Night Shift exported, as a new flow of the
 * project. Its name comes from the file name, with a suffix when the
 * project has that name already.
 */
export function ImportFlowButton({ projectId }: { projectId: string }) {
	const input = useRef<HTMLInputElement>(null);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const importFlow = useMutation(
		flowMutations.import({
			onSuccess: (saved) => {
				void queryClient.invalidateQueries({ queryKey: flowQueries.lists() });
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
					importFlow.mutate({
						projectId,
						name: flowNameOfFile(file.name),
						json: await file.text(),
					});
				}}
			/>
		</>
	);
}
