import type { HarnessName } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { Actor } from "../../contract";
import type { SettingsStore } from "../../settings";
import { type AgentSetupView, MAX_CODE } from "../domain/agent-status";
import type { AgentJobs } from "../domain/setup-jobs";
import {
	allowedSetup,
	codeNotWaitingProblem,
	pasteCodeProblem,
} from "../domain/setup-runs";
import type { AgentCatalog, Programs, SetupHere } from "./ports";
import { readAgentSetup } from "./read-agent-setup";

export type SendSignInCodePorts = {
	catalog: AgentCatalog;
	settings: Pick<SettingsStore, "current">;
	programs: Pick<Programs, "found">;
	here: SetupHere;
	jobs: AgentJobs;
};

/** Gives the waiting sign-in the code the browser shows. */
export const sendSignInCode =
	(ports: SendSignInCodePorts) =>
	(
		actor: Actor,
		request: { harness: HarnessName; code: string; here: boolean },
	): AgentSetupView => {
		allowedSetup(
			request.here,
			ports.here,
			(h) => ports.catalog.of(h),
			(h) => ports.catalog.label(h),
			request.harness,
		);
		const state = ports.jobs.jobOf(request.harness).state;
		const signIn = ports.jobs.runningOf(request.harness)?.signIn;
		if (!signIn || (state !== "code-needed" && state !== "signing-in")) {
			throw new Refusal(
				"conflict",
				codeNotWaitingProblem(ports.catalog.label(request.harness)),
			);
		}
		const line = request.code.replace(/[\r\n]+/g, "").trim();
		if (line.length === 0 || line.length > MAX_CODE) {
			throw new Refusal("invalid", pasteCodeProblem());
		}
		signIn.sendCode(line);
		const agent = readAgentSetup(ports)(actor, { here: true }).agents.find(
			(row) => row.harness === request.harness,
		);
		if (!agent) throw new Error(`No setup for ${request.harness}.`);
		return agent;
	};
