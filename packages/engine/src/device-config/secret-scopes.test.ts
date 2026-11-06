import { describe, expect, test } from "bun:test";
import {
	PERSONAL_ON_HOST,
	type SecretPlace,
	type SecretScopes,
	type SecretUse,
	secretScopes,
	takenOverSecrets,
} from "./secret-scopes";

/** The rule as one table: each use at each place, and what it reads (ADR 13, ADR 18). */

const step = { spaceId: "space-1", projectId: "app", runId: "run-1" };
const own: SecretPlace = { host: false };
const host: SecretPlace = { host: true };

describe("secretScopes", () => {
	test.each<[string, SecretUse, SecretPlace, SecretScopes]>([
		[
			"the Person's own step on their own computer reads every scope",
			{ run: step },
			own,
			{ personal: "read", shared: step },
		],
		[
			"a step on a Host reads no Personal secret, also its owner's (ADR 18)",
			{ run: step },
			host,
			{ personal: "host", shared: step },
		],
		[
			"another Person's step under an Offer reads no Personal secret (ADR 13, decision 5)",
			{ run: step, underOffer: true },
			own,
			{ personal: "offer", shared: step },
		],
		[
			"under an Offer on a Host, the Offer's reason wins: the owner's Personal secrets are not the starter's to hear about",
			{ run: step, underOffer: true },
			host,
			{ personal: "offer", shared: step },
		],
		[
			"a use outside a run reads no Space or Project secret",
			{},
			own,
			{ personal: "read", shared: null },
		],
		[
			"a use outside a run on a Host reads this computer and the environment only",
			{},
			host,
			{ personal: "host", shared: null },
		],
	])("%s", (_name, use, at, expected) => {
		expect(secretScopes(use, at)).toEqual(expected);
	});

	test("the words of a move say which secrets work there (ADR 17)", () => {
		expect(takenOverSecrets(own)).toBe(
			"Space and project secrets work there. Secrets saved only on another computer do not.",
		);
		expect(takenOverSecrets(host)).toBe(
			"Space and project secrets work there. Personal secrets and secrets saved on another computer do not.",
		);
	});

	test("the words of a Personal secret on a Host say where to move it (ADR 18)", () => {
		expect(PERSONAL_ON_HOST).toContain("Move it to the Space or the project.");
	});
});
