import { useChanged } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@nightshift/ui/components/breadcrumb";
import { Button } from "@nightshift/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlertIcon, CircleCheckIcon, PlusIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { projectQueries } from "@/features/projects";
import {
	type AgentSetupJob,
	type AgentSetupStatus,
	type AgentSetupView,
	type DeciderSetupJob,
	type DeciderSetupStatus,
	type HarnessRowName,
	orpc,
} from "@/shared/api";
import { itemOf } from "../agents-selection";
import {
	agentSetupMutations,
	agentSetupQueries,
	deciderSetupMutations,
	deciderSetupQueries,
	profileQueries,
} from "../queries";
import { allAnswer } from "./check-state";
import { CheckStep } from "./check-step";
import { justChosen, offerDecider, readyText } from "./decider-state";
import { DeciderStep } from "./decider-step";
import {
	nextPhase,
	type PathDone,
	pathDone,
	pathSteps,
	type SetupPhase,
	stepLine,
} from "./setup-path";
import {
	ANSWERS_FOR,
	justReady,
	pickAgent,
	setupRuns,
	setupStep,
} from "./setup-state";
import {
	BrowserStep,
	CheckingStep,
	ChooseAgentStep,
	InstallConfirmDialog,
	InstallingStep,
} from "./setup-steps";
import { useAgentChecks } from "./use-agent-checks";

/**
 * The guided setup of an agent on this computer (ADR 25): choose Claude
 * Code or Codex, install it after a question, sign in in the browser.
 * Night Shift then adds the agent with a profile, and the profile opens.
 * Then, while no decider was chosen, the decider step (Q22): Local or
 * TypeSafe Jev, or Skip.
 *
 * On Home it is one path of four steps (`setup-path.ts`): connect an
 * agent, choose a model that decides, check that Night Shift's agents
 * answer, add a project. A line on top shows the steps and which are done.
 */

/** What the setup can do here, and each agent's job. Quiet when it fails: what needs it hides. */
export function useAgentSetupStatus() {
	return useQuery({
		...agentSetupQueries.status(),
		meta: { quietErrors: true },
	});
}

/**
 * The actions of the setup. Each puts the job it started in the status,
 * so the status asks again until the job ends.
 */
export function useAgentSetupActions() {
	const queryClient = useQueryClient();
	const put = (view: AgentSetupView) =>
		queryClient.setQueryData(
			agentSetupQueries.status().queryKey,
			(old: AgentSetupStatus | undefined) =>
				old && {
					...old,
					agents: old.agents.map((agent) =>
						agent.harness === view.harness ? view : agent,
					),
				},
		);
	return {
		install: useMutation(agentSetupMutations.install({ onSuccess: put })),
		signIn: useMutation(agentSetupMutations.signIn({ onSuccess: put })),
		sendCode: useMutation(agentSetupMutations.sendCode({ onSuccess: put })),
		cancel: useMutation(
			agentSetupMutations.cancel({
				onSuccess: put,
				onError: (error) => toast.error(`Not stopped: ${error.message}`),
			}),
		),
	};
}

/** The job of a setup that made an agent ready, with its profile. */
type ReadyJob = Extract<AgentSetupJob, { state: "ready" }>;

/**
 * Follows the setup jobs. When one ends, the checks and the lists read
 * again. When one makes an agent ready, a toast says so and `onReady`
 * gets its profile. Mount it once per page: the dialog does.
 */
function useSetupEnd(
	status: AgentSetupStatus | undefined,
	onReady: (ready: ReadyJob) => void,
) {
	const changed = useChanged({ orpc });
	const seen = useRef(new Map<HarnessRowName, AgentSetupJob>());
	useEffect(() => {
		for (const agent of status?.agents ?? []) {
			const before = seen.current.get(agent.harness);
			seen.current.set(agent.harness, agent.job);
			if (!before || !setupRuns(before) || setupRuns(agent.job)) continue;
			// The job added a harness and a profile, or found the agent.
			changed("device", "programs");
			const ready = justReady(before, agent.job);
			if (!ready) continue;
			toast.success(`${agent.label} is ready`, {
				description: `The profile ${ready.profileName} uses it. ${ANSWERS_FOR}`,
			});
			onReady(ready);
		}
	}, [status, changed, onReady]);
}

/** The setup of a decider: the choices, and how a job goes. Quiet when it fails. */
export function useDeciderSetupStatus() {
	return useQuery({
		...deciderSetupQueries.status(),
		meta: { quietErrors: true },
	});
}

/** After a decider is chosen: a toast, and the lists that name it read again. */
function useDeciderChosen() {
	const changed = useChanged({ orpc });
	return useCallback(
		(decider: string) => {
			toast.success("The decider is ready", {
				description: readyText(decider),
			});
			// The settings and a Model Profile name it, and Ollama has its model.
			changed("device", "ollama");
		},
		[changed],
	);
}

/**
 * Follows the decider job. When a download ends with the decider ready,
 * `onChosen` says so, also while the dialog is closed.
 */
function useDeciderEnd(
	status: DeciderSetupStatus | undefined,
	onChosen: (decider: string) => void,
) {
	const seen = useRef<DeciderSetupJob | undefined>(undefined);
	useEffect(() => {
		if (!status) return;
		const before = seen.current;
		seen.current = status.job;
		const ready = justChosen(before, status.job);
		if (ready) onChosen(ready.decider);
	}, [status, onChosen]);
}

/**
 * Which steps of the setup are done on this computer. With `enabled`
 * false it does not ask who answers for Night Shift's agents.
 */
export function useSetupDone(enabled = true): PathDone {
	const profiles = useQuery({
		...profileQueries.agents(),
		meta: { quietErrors: true },
	});
	const decider = useDeciderSetupStatus();
	const projects = useQuery({
		...projectQueries.list(),
		meta: { quietErrors: true },
	});
	const { summary } = useAgentChecks(enabled);
	return pathDone({
		profiles: profiles.data?.length ?? 0,
		decider: decider.data,
		checked: allAnswer(summary),
		projects: projects.data?.length,
	});
}

/**
 * The setup dialog. `harness` picks the agent it opens on, `start` the
 * step: the decider opens the choice of a decider at once. It follows a
 * job that runs, also while it is closed. When the agent is ready, it
 * offers the decider step, or closes. Then the new profile opens, unless
 * `openProfile` is false: Home keeps its Get started card in view.
 *
 * With `onAddProject` it is the whole path of four steps: after each step
 * it opens the next one that is still open, and the last step calls
 * `onAddProject`. A step that is skipped stays open for later.
 */
export function AgentSetupDialog({
	open,
	onOpenChange,
	harness,
	start = "agent",
	openProfile = true,
	onAddProject,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	harness?: HarnessRowName;
	start?: SetupPhase;
	openProfile?: boolean;
	/** Opens the form of a new project. Given: the dialog is the path of four steps. */
	onAddProject?: () => void;
}) {
	const guided = onAddProject !== undefined;
	const done = useSetupDone(guided);
	const status = useAgentSetupStatus();
	const decider = useDeciderSetupStatus();
	const navigate = useNavigate();
	const [phase, setPhase] = useState<SetupPhase>(start);
	// Each time the dialog opens, it starts on the step it was asked for.
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) setPhase(start);
	}
	// The profile of an agent that became ready. It opens when the decider
	// step closes: opening it at once would leave this page, and the dialog.
	const [profile, setProfile] = useState<string | null>(null);
	const showProfile = (id: string) => {
		if (!openProfile) return;
		void navigate({
			to: "/settings",
			search: {
				section: "agents",
				item: itemOf({ kind: "profile", id }),
			},
		});
	};
	const close = () => {
		setPhase("agent");
		onOpenChange(false);
		if (profile !== null) {
			setProfile(null);
			showProfile(profile);
		}
	};
	const change = (next: boolean) => {
		if (next) onOpenChange(true);
		else close();
	};
	/** Opens the next step that is still open after `after`, or closes. */
	const advance = (after: SetupPhase, now: PathDone = done) => {
		const next = nextPhase(after, now);
		if (next === null) close();
		else setPhase(next);
	};
	useSetupEnd(status.data, (ready) => {
		if (open && guided) {
			// Without the decider's status, its step cannot show: the check is next.
			advance("agent", {
				...done,
				agent: true,
				decider: done.decider || !decider.data,
			});
		} else if (open && offerDecider(decider.data)) {
			setPhase("decider");
			setProfile(ready.profileId);
		} else {
			setPhase("agent");
			onOpenChange(false);
			showProfile(ready.profileId);
		}
	});
	const chosen = useDeciderChosen();
	const onChosen = (name: string) => {
		chosen(name);
		if (phase !== "decider") return;
		if (guided) advance("decider", { ...done, decider: true });
		else close();
	};
	// The step the dialog shows. Without the decider's status, the agent's
	// step shows. Only the path has a check and a project step.
	const shown: SetupPhase =
		phase === "decider"
			? decider.data
				? "decider"
				: "agent"
			: guided
				? phase
				: "agent";
	useDeciderEnd(decider.data, onChosen);
	return (
		<Dialog open={open} onOpenChange={change}>
			<DialogContent className="sm:max-w-lg">
				{open && guided ? <StepLine at={shown} done={done} /> : null}
				{!open ? null : shown === "check" ? (
					<CheckStep
						onFix={(fix) => setPhase(fix === "agent" ? "agent" : "decider")}
						onSkip={() => advance("check")}
						onContinue={() => advance("check", { ...done, check: true })}
					/>
				) : shown === "project" ? (
					<ProjectStep
						done={done.project}
						onLater={close}
						onAdd={() => {
							close();
							onAddProject?.();
						}}
					/>
				) : shown === "decider" && decider.data ? (
					<DeciderBody
						status={decider.data}
						onCheckAgain={() => decider.refetch()}
						checking={decider.isFetching}
						onChosen={onChosen}
						onSkip={() => (guided ? advance("decider") : change(false))}
					/>
				) : (
					<SetupBody
						status={status.data}
						loading={status.isPending}
						error={status.error?.message ?? null}
						wanted={harness}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

/** The line on top of the path: its four steps, which are done, and where the person is. */
function StepLine({ at, done }: { at: SetupPhase; done: PathDone }) {
	return (
		<Breadcrumb aria-label={stepLine(at)} className="pr-8">
			<BreadcrumbList>
				{pathSteps(at, done).map((step, index) => (
					<Fragment key={step.phase}>
						{index > 0 ? <BreadcrumbSeparator /> : null}
						<BreadcrumbItem>
							{step.done ? (
								<CircleCheckIcon
									className="size-3.5 text-status-finished"
									aria-hidden
								/>
							) : null}
							{step.state === "current" ? (
								<BreadcrumbPage aria-current="step">
									{step.label}
								</BreadcrumbPage>
							) : (
								step.label
							)}
							{step.done ? <span className="sr-only">, done</span> : null}
						</BreadcrumbItem>
					</Fragment>
				))}
			</BreadcrumbList>
		</Breadcrumb>
	);
}

/** The last step of the path: a project for the flows. */
function ProjectStep({
	done,
	onLater,
	onAdd,
}: {
	/** There is a project already. */
	done: boolean;
	onLater: () => void;
	onAdd: () => void;
}) {
	return (
		<>
			<DialogHeader>
				<DialogTitle>Add a project</DialogTitle>
				<DialogDescription>
					A project holds your flows and their runs. It needs no folder.
				</DialogDescription>
			</DialogHeader>
			<DialogFooter>
				<Button variant="outline" onClick={onLater}>
					{done ? "Done" : "Later"}
				</Button>
				<Button variant={done ? "outline" : "default"} onClick={onAdd}>
					<PlusIcon data-icon="inline-start" />
					Add project
				</Button>
			</DialogFooter>
		</>
	);
}

/** The decider step, with its actions: each puts the status it answers in the cache. */
function DeciderBody({
	status,
	onCheckAgain,
	checking,
	onChosen,
	onSkip,
}: {
	status: DeciderSetupStatus;
	onCheckAgain: () => void;
	checking: boolean;
	/** TypeSafe Jev is ready at once: no job to follow. */
	onChosen: (decider: string) => void;
	onSkip: () => void;
}) {
	const queryClient = useQueryClient();
	const put = (next: DeciderSetupStatus) =>
		queryClient.setQueryData(deciderSetupQueries.status().queryKey, next);
	const install = useMutation(
		deciderSetupMutations.installOllama({ onSuccess: put }),
	);
	const local = useMutation(deciderSetupMutations.useLocal({ onSuccess: put }));
	const typesafe = useMutation(
		deciderSetupMutations.useTypesafe({
			onSuccess: (next) => {
				put(next);
				if (next.job.state === "ready") onChosen(next.job.decider);
			},
		}),
	);
	const cancel = useMutation(
		deciderSetupMutations.cancel({
			onSuccess: put,
			onError: (error) => toast.error(`Not stopped: ${error.message}`),
		}),
	);
	const acting = [install, local, typesafe];
	return (
		<DeciderStep
			status={status}
			onSkip={onSkip}
			actions={{
				installOllama: () => {
					for (const m of acting) m.reset();
					install.mutate(undefined);
				},
				useLocal: () => {
					for (const m of acting) m.reset();
					local.mutate(undefined);
				},
				useTypesafe: (key) => {
					for (const m of acting) m.reset();
					typesafe.mutate(key === null ? {} : { key });
				},
				cancel: () => cancel.mutate(undefined),
				checkAgain: onCheckAgain,
				pending: acting.some((m) => m.isPending),
				checking,
				cancelling: cancel.isPending,
				error: acting.find((m) => m.error)?.error?.message ?? null,
			}}
		/>
	);
}

/** The step of the picked agent: the choice, the install, or the sign-in. */
function SetupBody({
	status,
	loading,
	error,
	wanted,
}: {
	status: AgentSetupStatus | undefined;
	loading: boolean;
	error: string | null;
	wanted: HarnessRowName | undefined;
}) {
	const [picked, setPicked] = useState(wanted);
	const [confirming, setConfirming] = useState(false);
	const actions = useAgentSetupActions();

	if (loading) {
		return (
			<div className="flex flex-col gap-3" aria-hidden>
				<Skeleton className="h-6 w-48" />
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-16 w-full" />
			</div>
		);
	}
	const agent = status ? pickAgent(status.agents, picked) : undefined;
	if (!status || !agent) {
		return (
			<>
				<DialogHeader>
					<DialogTitle>Set up an agent</DialogTitle>
				</DialogHeader>
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertTitle>The setup did not load</AlertTitle>
					{error ? <AlertDescription>{error}</AlertDescription> : null}
				</Alert>
			</>
		);
	}

	const harness = agent.harness;
	const step = setupStep(agent);
	const cancel = () => actions.cancel.mutate({ harness });
	const cancelling = actions.cancel.isPending;

	switch (step.kind) {
		case "choose":
			return (
				<>
					<ChooseAgentStep
						agents={status.agents}
						agent={agent}
						step={step}
						blocked={status.available ? null : status.message}
						onPick={(next) => {
							setPicked(next);
							actions.signIn.reset();
						}}
						onAct={() => {
							if (step.action === "install") setConfirming(true);
							else actions.signIn.mutate({ harness });
						}}
						acting={actions.signIn.isPending}
						error={actions.signIn.error?.message ?? null}
					/>
					<InstallConfirmDialog
						agent={agent}
						open={confirming}
						onOpenChange={(open) => {
							setConfirming(open);
							if (!open) actions.install.reset();
						}}
						onConfirm={() =>
							actions.install.mutate(
								{ harness },
								{ onSuccess: () => setConfirming(false) },
							)
						}
						pending={actions.install.isPending}
						error={actions.install.error?.message ?? null}
					/>
				</>
			);
		case "installing":
			return (
				<InstallingStep
					agent={agent}
					since={step.since}
					onCancel={cancel}
					cancelling={cancelling}
				/>
			);
		case "checking":
			return (
				<CheckingStep agent={agent} onCancel={cancel} cancelling={cancelling} />
			);
		case "browser":
			return (
				<BrowserStep
					agent={agent}
					url={step.url}
					codeNeeded={step.codeNeeded}
					onSendCode={(code, sent) =>
						actions.sendCode.mutate({ harness, code }, { onSuccess: sent })
					}
					sending={actions.sendCode.isPending}
					codeError={actions.sendCode.error?.message ?? null}
					onCancel={cancel}
					cancelling={cancelling}
				/>
			);
	}
}
