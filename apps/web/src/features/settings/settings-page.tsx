import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { CircleAlertIcon } from "lucide-react";
import { PageHeading, SiteHeader } from "@/shared/page";
import { AgentDefaultsCard } from "./components/agent-defaults-card";
import { AppearanceCard } from "./components/appearance-card";
import { NotificationsCard } from "./components/notifications-card";
import { PhoneCard } from "./components/phone-card";
import { ProjectsCard } from "./components/projects-card";
import { RunPolicyCard } from "./components/run-policy-card";
import { RunsCard } from "./components/runs-card";
import { ThisComputerLink } from "./components/this-computer-link";
import { settingsQueries } from "./queries";

/** The Settings page: projects, runs, run policy, new Agent nodes, notifications, the phone, appearance. */
export function SettingsPage() {
	const settings = useQuery(settingsQueries.get());

	return (
		<>
			<SiteHeader crumbs={[{ label: "Settings" }]} />
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<div className="mx-auto w-full max-w-4xl">
					<PageHeading
						title="Settings"
						description="How Night Shift runs your flows, what a new Agent node starts with, and when this Mac tells you."
					/>
				</div>

				<div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
					<ProjectsCard />
					{settings.data ? (
						<>
							<RunsCard data={settings.data} />
							<RunPolicyCard data={settings.data} />
							<AgentDefaultsCard data={settings.data} />
							<NotificationsCard data={settings.data} />
						</>
					) : settings.error ? (
						<Alert variant="destructive">
							<CircleAlertIcon />
							<AlertTitle>The settings did not load</AlertTitle>
							<AlertDescription>{settings.error.message}</AlertDescription>
							<AlertAction>
								<Button
									variant="outline"
									size="sm"
									disabled={settings.isFetching}
									onClick={() => void settings.refetch()}
								>
									{settings.isFetching ? (
										<Spinner data-icon="inline-start" />
									) : null}
									Try again
								</Button>
							</AlertAction>
						</Alert>
					) : (
						<>
							<Skeleton className="h-64 w-full rounded-xl" />
							<Skeleton className="h-56 w-full rounded-xl" />
							<Skeleton className="h-72 w-full rounded-xl" />
						</>
					)}
					<PhoneCard />
					<AppearanceCard />
					<ThisComputerLink name={settings.data?.daemon.device.name} />
				</div>
			</div>
		</>
	);
}
