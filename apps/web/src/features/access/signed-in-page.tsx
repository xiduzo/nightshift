/**
 * The page behind `/dashboard` after signing in. Kept for the sign-in
 * flow, which is not used in local single-user mode.
 */
export function SignedInPage({
	name,
}: {
	/** The name of the person who signed in. */
	name: string | undefined;
}) {
	return (
		<div>
			<h1>Dashboard</h1>
			<p>Welcome {name}</p>
		</div>
	);
}
