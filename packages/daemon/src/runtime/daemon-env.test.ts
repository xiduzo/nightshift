import { describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	AUTH_SECRET_FILE,
	authSecret,
	type DaemonEnv,
	prepareDaemonEnv,
	secretFiles,
	secretsDir,
} from "./daemon-env";

const dir = () => mkdtempSync(join(tmpdir(), "nightshift-env-"));
const SECRET = "s".repeat(40);

describe("the environment of a daemon without varlock", () => {
	test("fills what is missing, and keeps what is set", () => {
		const dataDir = dir();
		const env: Record<string, string | undefined> = {
			NIGHTSHIFT_DATA_DIR: dataDir,
			CORS_ORIGIN: "https://ui.example.com",
		};
		expect(
			prepareDaemonEnv({
				port: 3100,
				url: "http://localhost:3100",
				uiOrigin: "http://localhost:3001",
				env,
			}),
		).toEqual({ dataDir, env: env as DaemonEnv });
		expect(env.NODE_ENV).toBe("production");
		expect(env.PORT).toBe("3100");
		expect(env.BETTER_AUTH_URL).toBe("http://localhost:3100");
		expect(env.CORS_ORIGIN).toBe("https://ui.example.com");
		expect(env.BETTER_AUTH_SECRET?.length).toBe(64);
	});

	test("the auth secret is made once, readable by this user only", () => {
		const dataDir = dir();
		const first = authSecret({}, dataDir);
		expect(authSecret({}, dataDir)).toBe(first);
		const file = join(dataDir, AUTH_SECRET_FILE);
		expect(readFileSync(file, "utf8")).toBe(first);
		expect(statSync(file).mode & 0o777).toBe(0o600);
	});

	test("a file the service manager gives wins over the one in the data directory", () => {
		const dataDir = dir();
		authSecret({}, dataDir);
		const given = join(dir(), "auth");
		writeFileSync(given, `${SECRET}\n`);
		expect(authSecret({ BETTER_AUTH_SECRET_FILE: given }, dataDir)).toBe(
			SECRET,
		);
		const credentials = dir();
		writeFileSync(join(credentials, "BETTER_AUTH_SECRET"), SECRET);
		expect(authSecret({ CREDENTIALS_DIRECTORY: credentials }, dataDir)).toBe(
			SECRET,
		);
		writeFileSync(given, "short");
		expect(() =>
			authSecret({ BETTER_AUTH_SECRET_FILE: given }, dataDir),
		).toThrow("too short");
	});
});

describe("secret files on a computer without a keychain", () => {
	test("one file per secret, named as the secret", () => {
		const secrets = dir();
		writeFileSync(join(secrets, "GITHUB_TOKEN"), "ghp_value\n");
		writeFileSync(join(secrets, "not a name"), "skipped");
		mkdirSync(join(secrets, "FOLDER"));
		const target = join(dir(), "linked");
		writeFileSync(target, "linked value");
		symlinkSync(target, join(secrets, "LINKED"));
		expect(secretFiles(secrets)).toEqual({
			GITHUB_TOKEN: "ghp_value",
			LINKED: "linked value",
		});
		expect(secretFiles(null)).toEqual({});
		expect(secretFiles(join(secrets, "missing"))).toEqual({});
	});

	test("NIGHTSHIFT_SECRETS_DIR, else systemd's credentials", () => {
		expect(secretsDir({ NIGHTSHIFT_SECRETS_DIR: "/run/secrets" })).toBe(
			"/run/secrets",
		);
		expect(
			secretsDir({
				NIGHTSHIFT_SECRETS_DIR: " ",
				CREDENTIALS_DIRECTORY: "/run/credentials/nightshift.service",
			}),
		).toBe("/run/credentials/nightshift.service");
		expect(secretsDir({})).toBeNull();
	});
});
