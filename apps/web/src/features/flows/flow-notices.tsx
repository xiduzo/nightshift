import {
	Alert,
	AlertAction,
	AlertDescription,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import { toast } from "sonner";
import { flowMutations, flowQueries } from "./queries";

/**
 * What Night Shift did to the project's flows that the person did not
 * ask for: the import of a project folder from before flows moved into
 * Night Shift. Each notice stays on every Device until a person
 * dismisses it.
 */
export function FlowNotices({ projectId }: { projectId: string }) {
	const queryClient = useQueryClient();
	const notices = useQuery({
		...flowQueries.notices(projectId),
		meta: { quietErrors: true },
	});
	const dismiss = useMutation(
		flowMutations.dismissNotice({
			onSuccess: () =>
				void queryClient.invalidateQueries({
					queryKey: flowQueries.notices(projectId).queryKey,
				}),
			onError: (error) => toast.error(`Could not dismiss: ${error.message}`),
		}),
	);

	if (!notices.data || notices.data.length === 0) return null;
	return (
		<div className="flex flex-col gap-2">
			{notices.data.map((notice) => (
				<Alert key={notice.id}>
					<InfoIcon aria-hidden="true" />
					<AlertDescription>{notice.message}</AlertDescription>
					<AlertAction>
						<Button
							variant="outline"
							size="sm"
							disabled={dismiss.isPending}
							onClick={() => dismiss.mutate({ projectId, id: notice.id })}
						>
							Dismiss
						</Button>
					</AlertAction>
				</Alert>
			))}
		</div>
	);
}
