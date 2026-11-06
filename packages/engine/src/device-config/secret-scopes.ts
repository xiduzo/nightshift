/**
 * The Secret scope rule: which scopes one use of `${NAME}` reads, where
 * (ADR 13, decisions 3 to 5; ADR 18, decisions 1, 2 and 4). The one owner
 * of the rule. The connection store applies it when it resolves values,
 * and Placement reads its words when a step moves (ADR 17).
 *
 * The scopes, most specific first: Personal, the run's Space, its
 * Project, this computer, the environment.
 *
 * - Personal: the Person's, on their own computer, for their own step.
 *   Not on a Host, also when the Person owns it (ADR 18). Not under an
 *   Offer: the step is another Person's (ADR 13, decision 5).
 * - Space and Project: for a step of a run, on any Device (ADR 13,
 *   decision 3). The keeper of the Space answers both as one, the Space's
 *   first (`ProjectSecrets.values`), so the rule reads them as one scope.
 * - This computer and the environment: always, last.
 *
 * The facts come to it: the run from Placement (`forRun`), "under an
 * Offer" from the Offer admission of `@nightshift/devices` on the call it
 * admits, "Be a Host" from the settings store. The rule itself is pure.
 */

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

/** Where a use happens. */
export type SecretPlace = {
	/** "Be a Host" is on there. */
	host: boolean;
};

/** The scopes one use reads, by the rule. This computer and the environment are always read, last. */
export type SecretScopes = {
	/**
	 * The Person's Personal secrets: `read`, else why not. `offer`: the
	 * step is another Person's (ADR 13), whatever the place. `host`: the
	 * Person's own use is on a Host (ADR 18), and the person may hear it.
	 */
	personal: "read" | "host" | "offer";
	/** The run whose Space's and Project's secrets the use reads. Null: no run. */
	shared: StepRun | null;
};

/** Which scopes `use` reads at `at`. Pure: it reads nothing and throws nothing. */
export function secretScopes(use: SecretUse, at: SecretPlace): SecretScopes {
	return {
		personal: use.underOffer ? "offer" : at.host ? "host" : "read",
		shared: use.run ?? null,
	};
}

/** Why a Personal secret has no value on a Host (ADR 18), and what to do. */
export const PERSONAL_ON_HOST =
	"Personal secrets do not work on the Host. Move it to the Space or the project.";

/**
 * What a person reads when another Device takes a step over (ADR 17):
 * which secrets work there. A secret saved for one computer never leaves
 * it (ADR 13), so the ones saved only on the Device the step left do not.
 */
export function takenOverSecrets(at: SecretPlace): string {
	return secretScopes({}, at).personal === "read"
		? "Space and project secrets work there. Secrets saved only on another computer do not."
		: "Space and project secrets work there. Personal secrets and secrets saved on another computer do not.";
}
