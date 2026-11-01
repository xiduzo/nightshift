import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatDateTime, hoverTime } from "@/shared/format";
import { flowQueries } from "../../queries";
import { revisionAuthor } from "./revision-words";

/**
 * The Flow revision a run ran: when it was saved and by whom, as a link
 * that opens the flow's revisions on it.
 */
export function RunRevision({
	projectId,
	flowName,
	revisionId,
}: {
	projectId: string;
	flowName: string;
	revisionId: string;
}) {
	const revisions = useQuery(flowQueries.revisions(projectId, flowName));
	const item = revisions.data?.find((revision) => revision.id === revisionId);
	if (revisions.isLoading) {
		return <span className="text-muted-foreground">Loading…</span>;
	}
	if (!item) {
		return (
			<span className="text-muted-foreground">
				No longer in the flow's revisions
			</span>
		);
	}
	return (
		<Link
			to="/projects/$projectId/flows/$name"
			params={{ projectId, name: flowName }}
			search={{ revision: revisionId }}
			title={`${revisionAuthor(item)}. ${hoverTime(item.at)}`}
			className="truncate rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
		>
			Saved {formatDateTime(item.at)}
			{item.current ? " (current)" : ""}
		</Link>
	);
}
