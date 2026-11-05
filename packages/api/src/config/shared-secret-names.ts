/**
 * The names of the secrets every step of a project's runs can read: the
 * project's and its Space's (ADR 18). Null when they cannot be read now.
 */
export async function sharedSecretNames(
	context: {
		spaceId: string;
		session: { user: { id: string } };
		connections: {
			projectSecrets(
				project: { spaceId: string; projectId: string },
				personId: string,
			): Promise<readonly { name: string }[]>;
			spaceSecrets(
				spaceId: string,
				personId: string,
			): Promise<readonly { name: string }[]>;
		};
	},
	projectId: string,
): Promise<Set<string> | null> {
	const personId = context.session.user.id;
	const { spaceId } = context;
	try {
		const [project, space] = await Promise.all([
			context.connections.projectSecrets({ spaceId, projectId }, personId),
			context.connections.spaceSecrets(spaceId, personId),
		]);
		return new Set([...project, ...space].map((secret) => secret.name));
	} catch {
		return null;
	}
}
