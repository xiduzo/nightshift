/** The sentences a person reads when a connection cannot be expanded. */

/** An Agent node names a connection this computer does not have. */
export function noConnectionForNode(name: string): string {
	return `There is no connection named "${name}". Add it under Agents → Tools, or remove it from the node.`;
}

/** A test names a connection this computer does not have. */
export function noConnectionToTest(name: string): string {
	return `There is no connection named "${name}".`;
}
