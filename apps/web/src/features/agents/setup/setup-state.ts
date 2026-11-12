/**
 * The guided setup of an agent (ADR 25) as the screen shows it: the step a
 * setup job is at, what the person can do next, and the words that name
 * it. Pure: the jobs come from `agentSetup.status`, which the screen polls.
 */
import type {
	AgentSetupJob,
	AgentSetupView,
	CliCheck,
	HarnessRowName,
} from "@/shared/api";

/** How the last try of a setup ended, under the choice of agent. */
export type SetupNote =
	| { tone: "done"; text: string }
	/** `output`: what the installer printed last, for the details. */
	| { tone: "problem"; text: string; output: string | null };

/** What the setup dialog shows for one agent. */
export type SetupStep =
	/** Nothing runs: choose an agent, then install it or sign in. */
	| { kind: "choose"; action: "install" | "sign-in"; note: SetupNote | null }
	| { kind: "installing"; since: number }
	/** Night Shift checks the sign-in, before or after the browser. */
	| { kind: "checking" }
	/** The person finishes in the browser. `codeNeeded`: the agent waits for a code. */
	| { kind: "browser"; url: string | null; codeNeeded: boolean };

/** The step of one agent's setup, from its job. */
export function setupStep(agent: AgentSetupView): SetupStep {
	const { job } = agent;
	const action = agent.path ? "sign-in" : "install";
	switch (job.state) {
		case "idle":
		case "cancelled":
			return { kind: "choose", action, note: null };
		case "installed":
			return {
				kind: "choose",
				action: "sign-in",
				note: {
					tone: "done",
					text: `${agent.label} is installed. Sign in to use it.`,
				},
			};
		case "ready":
			return {
				kind: "choose",
				action: "sign-in",
				note: { tone: "done", text: `${agent.label} is ready.` },
			};
		case "install-failed":
			return {
				kind: "choose",
				action,
				note: {
					tone: "problem",
					text: job.problem,
					output: job.output.trim() ? job.output : null,
				},
			};
		case "sign-in-failed":
			return {
				kind: "choose",
				action,
				note: { tone: "problem", text: job.problem, output: null },
			};
		case "installing":
			return { kind: "installing", since: job.since };
		case "checking":
			return { kind: "checking" };
		case "signing-in":
		case "code-needed":
			return {
				kind: "browser",
				url: job.url,
				codeNeeded: job.state === "code-needed",
			};
	}
}

/** The job still runs: the screen shows its progress and asks again soon. */
export function setupRuns(job: AgentSetupJob): boolean {
	switch (job.state) {
		case "installing":
		case "checking":
		case "signing-in":
		case "code-needed":
			return true;
		default:
			return false;
	}
}

/**
 * The agent that a setup just made ready, with its profile: the job ran
 * before and is ready now. Null for a job that was ready already when the
 * screen first saw it.
 */
export function justReady(
	before: AgentSetupJob | undefined,
	after: AgentSetupJob,
): Extract<AgentSetupJob, { state: "ready" }> | null {
	if (after.state !== "ready" || !before || !setupRuns(before)) return null;
	return after;
}

/** The agent Night Shift suggests first: all real work so far runs on it. */
export const RECOMMENDED: HarnessRowName = "claude-code";

/**
 * The agent the dialog opens on: the one asked for, else one whose setup
 * runs, else the recommended one, else the first.
 */
export function pickAgent(
	agents: readonly AgentSetupView[],
	wanted?: HarnessRowName,
): AgentSetupView | undefined {
	return (
		agents.find((agent) => agent.harness === wanted) ??
		agents.find((agent) => setupRuns(agent.job)) ??
		agents.find((agent) => agent.harness === RECOMMENDED) ??
		agents[0]
	);
}

/** The account a person signs in with, as its sign-in page names it. */
const ACCOUNT: Partial<Record<HarnessRowName, string>> = {
	"claude-code": "Claude",
	codex: "ChatGPT",
};

export function signInAccount(
	agent: Pick<AgentSetupView, "harness" | "label">,
) {
	return ACCOUNT[agent.harness] ?? agent.label;
}

/** The main button of the choice: install, sign in, or add an agent that is signed in. */
export function actionLabel(
	agent: Pick<AgentSetupView, "harness" | "label">,
	action: "install" | "sign-in",
	signedIn: boolean,
): string {
	if (action === "install") return `Install ${agent.label}`;
	return signedIn ? `Add ${agent.label}` : `Sign in to ${signInAccount(agent)}`;
}

/** What an agent's card says under its name: who makes it, and whether it is here. */
export function agentSummary(
	agent: Pick<AgentSetupView, "vendor" | "path">,
): string {
	return `${agent.vendor} · ${agent.path ? "Installed" : "Not installed"}`;
}

/** How long an install takes, about: the bar moves toward 90 % in this time. */
const TYPICAL_INSTALL_MS = 60_000;

/**
 * How far the bar of an install is, in percent. The installer does not say,
 * so the bar follows the time: fast at first, then slower, and never past
 * 90 % until the install ends.
 */
export function installProgress(since: number, now: number): number {
	const elapsed = Math.max(0, now - since);
	return Math.round(90 * (1 - Math.exp((-2 * elapsed) / TYPICAL_INSTALL_MS)));
}

/**
 * What the agent's panel on the Agents page offers: install a missing
 * agent, sign in one that is signed out, or show the setup that runs. Null
 * when the agent is ready, when the check has not answered, or when Night
 * Shift cannot set this agent up.
 */
export function setupOffer(
	agent: AgentSetupView | undefined,
	check: Pick<CliCheck, "path" | "signIn"> | undefined,
): "install" | "sign-in" | "running" | null {
	if (!agent) return null;
	if (setupRuns(agent.job)) return "running";
	if (!check) return null;
	if (!check.path) return "install";
	return check.signIn === "signed_out" ? "sign-in" : null;
}
