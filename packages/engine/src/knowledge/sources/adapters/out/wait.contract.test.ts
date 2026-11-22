import { inMemoryWait } from "./in-memory-wait";
import { timerWait } from "./timer-wait";
import { waitContract } from "./wait.contract";

/** The contract of `Wait`, on both adapters. */

waitContract("in memory", async () => ({
	wait: inMemoryWait(),
	close: async () => {},
}));

waitContract("over the timer", async () => ({
	wait: timerWait(),
	close: async () => {},
}));
