import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import type { PersonActor } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { moveSecretToProject } from "./move-secret-to-project";

const ADA: PersonActor = { personId: "ada", door: "session" };

/** The use case moveSecretToProject, on in-memory adapters. */

const PROJECT = { spaceId: "space-1", projectId: "app" };

describe("moveSecretToProject", () => {
	test("from this computer: saved in the Project first, then this computer's copy goes", async () => {
		const ports = inMemorySecretsPorts();
		ports.computer.values.set("TOKEN", "s3cret");
		ports.facts.saved().set("TOKEN", 1);
		await moveSecretToProject(ports)(ADA, {
			name: "TOKEN",
			from: "computer",
			project: PROJECT,
		});
		expect(ports.projectTwin.projects.get("app")?.get("TOKEN")?.value).toBe(
			"s3cret",
		);
		expect(ports.computer.values.has("TOKEN")).toBe(false);
		expect(ports.known.projectNamesOf("app").has("TOKEN")).toBe(true);
		// The keeper gets the Person who asks.
		expect(ports.projectTwin.calls.map((c) => c.args.at(-1))).toEqual(
			ports.projectTwin.calls.map(() => "ada"),
		);
		expect(ports.projectTwin.calls).not.toEqual([]);
	});

	test("from Personal: the Personal copy goes after the Project has it", async () => {
		const ports = inMemorySecretsPorts();
		ports.personalTwin.secrets.set("TOKEN", { value: "s3cret", setAt: 1 });
		await moveSecretToProject(ports)(ADA, {
			name: "TOKEN",
			from: "personal",
			project: PROJECT,
		});
		expect(ports.personalTwin.secrets.has("TOKEN")).toBe(false);
		expect(ports.projectTwin.projects.get("app")?.has("TOKEN")).toBe(true);
	});

	test("a refusal of the keeper keeps this computer's copy", async () => {
		const ports = inMemorySecretsPorts();
		ports.computer.values.set("TOKEN", "s3cret");
		ports.facts.saved().set("TOKEN", 1);
		ports.projectTwin.fail(new Error("refused"));
		await expect(
			moveSecretToProject(ports)(ADA, {
				name: "TOKEN",
				from: "computer",
				project: PROJECT,
			}),
		).rejects.toThrow("refused");
		expect(ports.computer.values.get("TOKEN")).toBe("s3cret");
	});

	test("refuses a name the scope has no value of", async () => {
		const ports = inMemorySecretsPorts();
		const move = moveSecretToProject(ports);
		await expect(
			move(ADA, {
				name: "TOKEN",
				from: "computer",
				project: PROJECT,
			}),
		).rejects.toThrow("This computer has no saved value of TOKEN.");
		await expect(
			move(ADA, {
				name: "TOKEN",
				from: "personal",
				project: PROJECT,
			}),
		).rejects.toThrow("TOKEN is not a Personal secret.");
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = moveSecretToProject({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) =>
			act(actor, { project: {} } as never),
		),
	).toEqual(ONLY_THE_OWNER);
});
