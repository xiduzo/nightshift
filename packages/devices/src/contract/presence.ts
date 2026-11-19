/**
 * A paired Device whose Link says nothing for this long is offline: three
 * of its heartbeats, which come every 15 s. The Host's two answers to
 * "is it online?" use the same window: the registry's sweep (`online`,
 * for people) and the work hub's (`online`, for placement).
 */
export const OFFLINE_AFTER_MS = 45_000;
