import { inMemoryHostCalls } from "../calls/adapters/out/in-memory-host-calls";
import { keptStores } from "../kept/test-support";

/** The Personal secrets over a database in memory, on a clock at 7, and what is kept. */
export async function personalSecrets() {
	const { personal, personalRows } = await keptStores();
	return { store: personal, rows: personalRows };
}

/** The ports of a computer of Ada, without a Home Host until a test gives one. */
export async function personalPorts() {
	return {
		...(await personalSecrets()),
		calls: inMemoryHostCalls(),
		ownerId: "person-ada",
		selfId: "device-self",
		deadlineMs: 20_000,
	};
}
