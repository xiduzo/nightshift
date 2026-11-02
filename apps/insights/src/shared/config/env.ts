import { z } from "zod";

const text = z.preprocess(
	(value) => (value === undefined ? "" : value),
	z.string(),
);

function port(fallback: number) {
	return z.preprocess(
		(value) => (value === undefined || value === "" ? fallback : value),
		z.coerce.number().int().positive(),
	);
}

const schema = z.object({
	DATABASE_URL: z.string().min(1),
	BETTER_AUTH_SECRET: z.string().min(1),
	INSIGHTS_PORT: port(8787),
	INSIGHTS_INGEST_PORT: port(8788),
	INSIGHTS_INGEST_HOST: z.preprocess(
		(value) => (value === undefined || value === "" ? "127.0.0.1" : value),
		z.string().min(1),
	),
	INSIGHTS_GITHUB_CLIENT_ID: text,
	INSIGHTS_GITHUB_CLIENT_SECRET: text,
	INSIGHTS_GITHUB_LOGINS: text,
	INSIGHTS_ADMIN_EMAIL: text,
	INSIGHTS_ADMIN_PASSWORD: text,
});

export type Env = z.infer<typeof schema>;

/** Reads the process environment. A missing database or secret stops startup. */
export function readEnv(source: NodeJS.ProcessEnv): Env {
	const parsed = schema.safeParse(source);
	if (parsed.success) return parsed.data;
	const missing = parsed.error.issues.some((issue) => {
		const key = issue.path[0];
		return key === "DATABASE_URL" || key === "BETTER_AUTH_SECRET";
	});
	throw new Error(
		missing
			? "Set DATABASE_URL and BETTER_AUTH_SECRET."
			: "Check the environment values.",
	);
}
