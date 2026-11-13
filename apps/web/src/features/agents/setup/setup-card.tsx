import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleCheckIcon, CircleDashedIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AddProjectDialog, projectQueries } from "@/features/projects";
import type { AgentProfileRow } from "@/shared/api";
import { profileQueries } from "../queries";
import {
	AgentSetupDialog,
	useAgentSetupStatus,
	useDeciderSetupStatus,
} from "./agent-setup-dialog";
import {
	agentRow,
	checkRow,
	chooseLater,
	deciderRow,
	laterChosen,
	projectRow,
	requiredStepOpen,
	type SetupCardAction,
	type SetupCardRow,
	setupCardLine,
} from "./setup-card-state";
import type { SetupPhase } from "./setup-path";
import { useAgentChecks } from "./use-agent-checks";

function sessionStore(): Storage | undefined {
	try {
		return window.sessionStorage;
	} catch {
		return undefined;
	}
}

/**
 * Get started, on Home: the four steps of the setup (an agent, a model
 * that decides, the check, a project), each with its state and one action.
 * A person who skipped a step continues from its row. It shows while a
 * required step is open: this computer has no Agent Profile, or there is
 * no project (`requiredStepOpen`). Once it shows, it stays while you work
 * through it, so each row turns done. Later hides it until the next
 * session. `always`: Settings shows it whatever is done.
 */
export function SetupCard({ always = false }: { always?: boolean } = {}) {
	const profiles = useQuery({
		...profileQueries.agents(),
		meta: { quietErrors: true },
	});
	const projects = useQuery({
		...projectQueries.list(),
		meta: { quietErrors: true },
	});
	const [later, setLater] = useState(() => laterChosen(sessionStore()));
	const [shown, setShown] = useState(false);
	if (requiredStepOpen(profiles.data, projects.data) && !shown) setShown(true);
	if (!always && (!shown || later)) return null;
	return (
		<SetupCardBody
			profiles={profiles.data ?? []}
			onLater={() => {
				chooseLater(sessionStore());
				setLater(true);
			}}
		/>
	);
}

function SetupCardBody({
	profiles,
	onLater,
}: {
	profiles: AgentProfileRow[];
	onLater: () => void;
}) {
	const setup = useAgentSetupStatus();
	const decider = useDeciderSetupStatus();
	const projects = useQuery(projectQueries.list());
	// One setup dialog for the page: each mounted dialog follows the jobs.
	const [dialog, setDialog] = useState<{ open: boolean; start: SetupPhase }>({
		open: false,
		start: "agent",
	});
	const [adding, setAdding] = useState(false);

	const agent = agentRow(profiles, setup.isError ? null : setup.data);
	const choice = deciderRow(decider.isError ? null : decider.data);
	// Who answers is asked once an agent is connected: before that, nothing can.
	const checks = useAgentChecks(agent.done);
	const check = checkRow(agent.done, checks.loading ? null : checks.summary);
	const project = projectRow(projects.data);
	// The next required step gets the main button.
	const next = !agent.done ? "agent" : !project.done ? "project" : null;

	const act = (action: SetupCardAction, main: boolean): ReactNode => {
		const variant = main ? "default" : "outline";
		switch (action.kind) {
			case "set-up":
				return (
					<Button
						size="sm"
						variant={action.running ? "outline" : variant}
						onClick={() => setDialog({ open: true, start: "agent" })}
					>
						{action.running ? <Spinner data-icon="inline-start" /> : null}
						{action.running === "installing"
							? "Installing…"
							: action.running === "signing-in"
								? "Signing in…"
								: "Set up"}
					</Button>
				);
			case "choose":
				return (
					<Button
						size="sm"
						variant="outline"
						onClick={() => setDialog({ open: true, start: "decider" })}
					>
						Choose
					</Button>
				);
			case "check":
				return (
					<Button
						size="sm"
						variant="outline"
						onClick={() => setDialog({ open: true, start: "check" })}
					>
						{action.again ? "Open check" : "Check"}
					</Button>
				);
			case "add-project":
				return (
					<Button size="sm" variant={variant} onClick={() => setAdding(true)}>
						<PlusIcon data-icon="inline-start" />
						Add project
					</Button>
				);
			case "open":
				return (
					<Button
						size="sm"
						variant="outline"
						nativeButton={false}
						render={
							action.page === "agents" ? (
								<Link to="/settings" search={{ section: "agents" }} />
							) : (
								<Link to="/settings" />
							)
						}
					>
						{action.page === "agents" ? "Open Agents" : "Open Settings"}
					</Button>
				);
		}
	};

	return (
		<>
			<Card size="sm">
				<CardHeader>
					<CardTitle>Get started</CardTitle>
					<CardDescription>
						{setupCardLine(agent.done, project.done)}
					</CardDescription>
					<CardAction>
						<Button variant="ghost" size="sm" onClick={onLater}>
							{next === null ? "Done" : "Later"}
						</Button>
					</CardAction>
				</CardHeader>
				<CardContent>
					<ItemGroup className="gap-2">
						<SetupRow
							title="Connect an agent"
							row={agent}
							action={agent.action && act(agent.action, next === "agent")}
						/>
						<SetupRow
							title="Choose a model that decides"
							optional
							row={choice}
							action={choice.action && act(choice.action, false)}
						/>
						<SetupRow
							title="Check Night Shift's agents"
							optional
							row={check}
							action={check.action && act(check.action, false)}
						/>
						<SetupRow
							title="Add a project"
							row={project}
							action={project.action && act(project.action, next === "project")}
						/>
					</ItemGroup>
				</CardContent>
			</Card>
			<AgentSetupDialog
				open={dialog.open}
				onOpenChange={(open) => setDialog((now) => ({ ...now, open }))}
				start={dialog.start}
				openProfile={false}
				onAddProject={() => setAdding(true)}
			/>
			<AddProjectDialog open={adding} onOpenChange={setAdding} />
		</>
	);
}

/** One step of the card: done or not, what it means, and its action. */
function SetupRow({
	title,
	optional = false,
	row,
	action,
}: {
	title: string;
	optional?: boolean;
	row: SetupCardRow;
	action: ReactNode;
}) {
	return (
		<Item variant="outline" size="sm">
			<ItemMedia variant="icon">
				{row.done ? (
					<CircleCheckIcon className="text-status-finished" />
				) : (
					<CircleDashedIcon className="text-muted-foreground" />
				)}
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle>
					{row.done ? <span className="sr-only">Done: </span> : null}
					{title}
					{optional ? <Badge variant="outline">Optional</Badge> : null}
				</ItemTitle>
				<ItemDescription className="break-words">{row.text}</ItemDescription>
			</ItemContent>
			{action ? <ItemActions>{action}</ItemActions> : null}
		</Item>
	);
}
