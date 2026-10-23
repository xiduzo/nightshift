import {
	createDashboardQueries,
	createGateQueries,
	waitingText,
} from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import {
	FolderGit2,
	History,
	Laptop,
	Plus,
	Search,
	Settings,
	Workflow,
} from "lucide-react-native";

import { StatCards } from "@/features/dashboard";
import { useHostQueries, useSignedIn } from "@/features/host";
import { useWaitingCount } from "@/features/inbox";
import { AvatarButton, HeaderButton, LargeTitleHeader } from "@/shared/header";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { useScreenRefresh } from "@/shared/refresh";

/**
 * Home: what happened while you were away, and the way to the rest of
 * your work. The avatar opens Settings, + starts a run, the magnifier
 * searches.
 */
export function HomeScreen() {
	const { person } = useSignedIn();
	const dashboard = useHostQueries(createDashboardQueries);
	const gates = useHostQueries(createGateQueries);
	const summary = useQuery(dashboard.summary({ everySpace: true }));
	const open = useQuery(gates.open());
	const waiting = useWaitingCount();
	const refresh = useScreenRefresh([summary.refetch, open.refetch]);

	return (
		<Screen onRefresh={refresh}>
			<LargeTitleHeader
				title="Last night"
				summary={waitingText(waiting)}
				leading={
					<AvatarButton
						name={person.name}
						label="Settings"
						hint={`Signed in as ${person.name}`}
						href="/settings"
					/>
				}
				actions={
					<>
						<HeaderButton icon={Plus} label="New run" href="/start" />
						<HeaderButton icon={Search} label="Search" href="/search" />
					</>
				}
			/>
			<StatCards
				summary={summary.data}
				waiting={open.data ? open.data.length : null}
			/>
			<SectionHead title="Your work" />
			<ListGroup>
				<ListRow icon={History} title="Runs" href="/runs" />
				<ListRow
					icon={Workflow}
					title="Flows"
					caption="How often their runs finish"
					href="/flows"
				/>
				<ListRow icon={FolderGit2} title="Projects" href="/projects" />
				<ListRow
					icon={Laptop}
					title="Computers"
					caption="Where your flows run"
					href="/computers"
				/>
				<ListRow icon={Settings} title="Settings" href="/settings" />
			</ListGroup>
		</Screen>
	);
}
