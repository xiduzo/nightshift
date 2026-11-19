/** A Project, with the Space it is in. */
export type ProjectRef = { spaceId: string; projectId: string };

/**
 * The run a step works for: its Space, its Project and its id. The step
 * reads the Space's and the Project's secrets (ADR 13). The Host that keeps
 * them checks that the step runs on the Device that asks.
 */
export type StepRun = ProjectRef & { runId: string };

/**
 * One use of `${NAME}`: the facts of where it happens. The rule decides
 * what they read.
 */
export type SecretUse = {
	/**
	 * The run the step works for. Without it: a use outside a run, such as
	 * a connection test, a webhook or a tool's sign-in.
	 */
	run?: StepRun;
	/**
	 * The step is another Person's, through an Offer of this Device. Only
	 * the Offer admission on the Device that runs it sets it, after the wire.
	 */
	underOffer?: true;
};

/**
 * Environment values read from the secrets, or the names that have no
 * value, and why a missing one may have a value after all (`NotRead`).
 */
export type SecretEnv =
	| {
			ok: true;
			env: Record<string, string>;
			/** The names whose value is the run's Project's. */
			fromProject?: string[];
	  }
	| ({ ok: false; missing: string[] } & NotRead);

/**
 * Why a missing name may have a value after all: `unreachable`, the
 * Personal secrets could not be read now (`PERSONAL_UNREACHABLE`);
 * `projectUnreachable`, the Project's (`PROJECT_UNREACHABLE`);
 * `personalHere`, it is a Personal secret and this computer is a Host.
 */
export type NotRead = {
	unreachable?: boolean;
	projectUnreachable?: boolean;
	personalHere?: boolean;
};
