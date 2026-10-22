/** "Keep this computer awake": the OS's sleep lock, held while a run needs this computer. */

export { createKeepAwake, engineRunSource, type KeepAwake } from "./keep-awake";
export { systemSleepLock } from "./sleep-lock";
