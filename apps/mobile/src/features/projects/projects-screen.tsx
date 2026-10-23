import { createProjectQueries } from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { FolderGit2 } from "lucide-react-native";

import { useHostQueries } from "@/features/host";
import { SpacePicker } from "@/features/spaces";
import { InitialsAvatar } from "@/shared/avatar";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { LargeTitleHeader } from "@/shared/header";
import { ListGroup, ListRow } from "@/shared/list";
import { Screen } from "@/shared/page";
import { useScreenRefresh } from "@/shared/refresh";

/** The projects of the Space you chose in the header. A tap opens one. */
export function ProjectsScreen() {
	const projectQueries = useHostQueries(createProjectQueries);
	const projects = useQuery(projectQueries.list());
	const refresh = useScreenRefresh([projects.refetch]);
	const list = projects.data;

	return (
		<Screen onRefresh={refresh}>
			<LargeTitleHeader
				title="Projects"
				summary={
					list
						? list.length === 1
							? "1 project in this Space"
							: `${list.length} projects in this Space`
						: undefined
				}
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
						{list.map((project) => (
							<ListRow
								key={project.id}
								leading={<InitialsAvatar name={project.name} />}
								title={project.name}
								caption={project.remote ?? undefined}
								href={{
									pathname: "/projects/[projectId]",
									params: { projectId: project.id },
								}}
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
