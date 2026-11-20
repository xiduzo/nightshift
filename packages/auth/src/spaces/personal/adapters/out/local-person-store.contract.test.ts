import { memoryDb } from "../../test-support";
import { drizzleLocalPersonStore } from "./drizzle-local-person-store";
import { inMemoryLocalPersonStore } from "./in-memory-local-person-store";
import { localPersonStoreContract } from "./local-person-store.contract";

/** The contract of `LocalPersonStore`, on both adapters. The real one runs on libsql in memory. */

localPersonStoreContract("in memory", async () => ({
	localPersonStore: inMemoryLocalPersonStore(),
	close: async () => {},
}));

localPersonStoreContract("over drizzle", async () => ({
	localPersonStore: drizzleLocalPersonStore(await memoryDb()),
	close: async () => {},
}));
