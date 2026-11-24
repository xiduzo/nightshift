import type { Env } from "@/shared/config";

import type { AdminAuth } from "./auth";

/**
 * When no person exists yet, and both admin values are set, creates that
 * one admin. The password is never written to a log or an error.
 */
export async function ensureAdmin(auth: AdminAuth, env: Env): Promise<void> {
	const email = env.INSIGHTS_ADMIN_EMAIL;
	const password = env.INSIGHTS_ADMIN_PASSWORD;
	if (email === "" || password === "") return;
	try {
		const context = await auth.$context;
		const total = await context.internalAdapter.countTotalUsers();
		if (total > 0) return;
		const hash = await context.password.hash(password);
		const created = await context.adapter.create({
			model: "user",
			data: {
				email: email.toLowerCase(),
				name: "Admin",
				emailVerified: true,
				role: "admin",
			},
		});
		const id = created.id;
		if (typeof id !== "string" || id === "") {
			throw new Error("The admin account was not created.");
		}
		await context.internalAdapter.linkAccount({
			userId: id,
			providerId: "credential",
			accountId: id,
			password: hash,
		});
	} catch (error) {
		throw sanitized(error);
	}
}

/** Keeps a password and a database URL out of the startup error. */
function sanitized(error: unknown): Error {
	const message = error instanceof Error ? error.message : "";
	const clean = message.replace(/postgres:\/\/\S+/gi, "database");
	if (clean === "" || /password|postgres:\/\//i.test(clean)) {
		return new Error("The admin account was not created.");
	}
	return new Error(clean);
}
