import {
	createGateQueries,
	createProjectQueries,
	createRunQueries,
} from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { FolderGit2 } from "lucide-react-native";
import { useMemo } from "react";

import { useHostQueries } from "@/features/host";
import { SpacePicker } from "@/features/spaces";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { useNow } from "@/shared/format";
import { LargeTitleHeader } from "@/shared/header";
import { ListGroup } from "@/shared/list";
import { Screen } from "@/shared/page";
import { useScreenRefresh } from "@/shared/refresh";
import { projectOverviews, projectsSummary } from "./overview";
import { ProjectRow } from "./rows";

/**
 * The projects of the Space you chose in the header: for each, what needs
 * you and its last run. A tap opens one.
 */
export function ProjectsScreen() {
	const projectQueries = useHostQueries(createProjectQueries);
	const gateQueries = useHostQueries(createGateQueries);
	const runQueries = useHostQueries(createRunQueries);
	const projects = useQuery(projectQueries.list());
	const gates = useQuery(gateQueries.open());
	const runs = useQuery(runQueries.everyRun());
	const refresh = useScreenRefresh([
		projects.refetch,
		gates.refetch,
		runs.refetch,
	]);

	const list = projects.data;
	const overviews = useMemo(
		() => projectOverviews(list ?? [], gates.data ?? [], runs.data ?? []),
		[list, gates.data, runs.data],
	);
	const needsYou = overviews.reduce((sum, row) => sum + row.needsYou, 0);
	// Again every 30 s: often enough for "3 h ago".
	const now = useNow();

	return (
		<Screen onRefresh={refresh}>
			<LargeTitleHeader
				title="Projects"
				summary={list ? projectsSummary(list.length, needsYou) : undefined}
				actions={<SpacePicker />}
			/>
			{list ? (
				list.length === 0 ? (
					<EmptyState
						icon={FolderGit2}
						title="No projects yet"
						description="A project is a repository your flows work in. Add one in Night Shift on your computer."
					/>
				) : (
					<ListGroup>
						{overviews.map((overview) => (
							<ProjectRow
								key={overview.project.id}
								overview={overview}
								now={now}
							/>
						))}
					</ListGroup>
				)
			) : projects.isError ? (
				<ErrorAlert
					title="The projects did not load"
					message={projects.error.message}
					fix="Check that this phone is online, then try again."
					onRetry={() => void projects.refetch()}
				/>
			) : (
				<Skeleton className="h-40 w-full rounded-xl" />
			)}
		</Screen>
	);
}
