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
import { HeaderToolbar } from "@/shared/header";
import { ListGroup } from "@/shared/list";
import { Screen } from "@/shared/page";
import { useScreenRefresh, useWhileFocused } from "@/shared/refresh";
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
	const projects = useQuery({ ...projectQueries.list(), ...useWhileFocused() });
	const gates = useQuery({ ...gateQueries.open(), ...useWhileFocused() });
	const list = projects.data;
	// The Host says the last run of each project. An older Host does not:
	// then every run tells it.
	const counted = list?.every((project) => project.runs !== undefined) ?? true;
	const runs = useQuery({
		...runQueries.everyRun(),
		enabled: !counted,
		...useWhileFocused(),
	});
	const refresh = useScreenRefresh(
		counted
			? [projects.refetch, gates.refetch]
			: [projects.refetch, gates.refetch, runs.refetch],
	);

	const lastRuns = useMemo(
		() =>
			counted
				? (list ?? []).flatMap((project) =>
						project.runs?.last
							? [{ ...project.runs.last, projectId: project.id }]
							: [],
					)
				: (runs.data ?? []),
		[counted, list, runs.data],
	);
	const overviews = useMemo(
		() => projectOverviews(list ?? [], gates.data ?? [], lastRuns),
		[list, gates.data, lastRuns],
	);
	const needsYou = overviews.reduce((sum, row) => sum + row.needsYou, 0);

	return (
		<Screen
			onRefresh={refresh}
			summary={list ? projectsSummary(list.length, needsYou) : undefined}
		>
			<HeaderToolbar
				placement="right"
				items={[{ kind: "view", key: "space", element: <SpacePicker /> }]}
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
							<ProjectRow key={overview.project.id} overview={overview} />
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
