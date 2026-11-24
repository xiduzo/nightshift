/**
 * The driven ports of spaces. A port of its own has a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`.
 */

/** The policy of each Space, in its Space document. */
export type SpacePolicies = {
	/**
	 * Turns anonymous usage on or off for the Space, in one change of its
	 * document. False: a Host keeps the Space, and nothing changes here.
	 */
	setUsage(spaceId: string, enabled: boolean): Promise<boolean>;
	/**
	 * Whether usage is on, for every Space this Replica has. Missing
	 * means on.
	 */
	usageOn(): Promise<boolean[]>;
};
