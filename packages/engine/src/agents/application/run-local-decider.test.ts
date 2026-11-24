import { expect, test } from "bun:test";
import {
	inMemoryDeciderSetupPorts,
	inMemoryLocalOllama,
} from "../adapters/out/in-memory-neighbours";
import { createDeciderJob } from "../domain/setup-jobs";
import { runLocalDecider } from "./run-local-decider";

test("a model that is here becomes the decider of new nodes, on the profile local", async () => {
	const twins = inMemoryDeciderSetupPorts();
	const ollama = inMemoryLocalOllama({
		answers: false,
		models: [twins.localModel.name],
	});
	const job = createDeciderJob();
	await runLocalDecider({ ...twins, ollama })(job.begin());
	expect(job.read()).toMatchObject({ state: "ready", profileName: "local" });
	expect(twins.profiles.byName("local")).toMatchObject({ decider: "ollama" });
	expect(twins.settings.current().decisionDecider).toBe("ollama");
	expect(ollama.state.refreshes).toBe(1);
});
