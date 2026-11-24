import { device, runCommand } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { deviceStoreContract } from "./device-store.contract";
import { drizzleDeviceStore } from "./drizzle-device-store";
import {
	inMemoryBatch,
	inMemoryDeviceStore,
	runInMemory,
} from "./in-memory-device-store";

/** The contract of `DeviceStore`, on both adapters. The real one runs on libsql in memory. */

deviceStoreContract("in memory", async () => {
	const deviceStore = inMemoryDeviceStore();
	return {
		deviceStore,
		run: async (batch) => runInMemory(batch),
		engine: inMemoryBatch(),
		addCommand: async (id, walkerId) => {
			deviceStore.commandWalkers.set(id, walkerId);
		},
		commandWalker: async (id) => deviceStore.commandWalkers.get(id) ?? null,
		close: async () => {},
	};
});

deviceStoreContract("over drizzle", async () => {
	const db = await migratedDb();
	// An empty Replica: without the row the migrations may make.
	await db.delete(device);
	return {
		deviceStore: drizzleDeviceStore(db),
		run: async (batch) => {
			const [first, ...rest] = batch as unknown as BatchItem<"sqlite">[];
			if (first) await db.batch([first, ...rest]);
		},
		engine: [],
		addCommand: async (id, walkerId) => {
			await db.insert(runCommand).values({
				id,
				spaceId: "space-1",
				runId: "run-1",
				walkerId,
				kind: "run.stop",
				payload: "{}",
				personId: "person-ada",
			});
		},
		commandWalker: async (id) => {
			const [row] = await db
				.select({ walkerId: runCommand.walkerId })
				.from(runCommand)
				.where(eq(runCommand.id, id));
			return row?.walkerId ?? null;
		},
		close: async () => {},
	};
});
