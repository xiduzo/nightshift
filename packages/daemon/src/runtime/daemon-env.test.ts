import { describe, expect, test } from "bun:test";
import {
	existsSync,
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
	daemonAuthSecret,
	prepareDaemonEnv,
	SECRETS_KEY_FILE,
	secretFiles,
	secretsDir,
	secretsKey,
	webPushSubject,
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

	test("puts the agents' install folder on a short PATH", () => {
		const home = dir();
		mkdirSync(join(home, ".local/bin"), { recursive: true });
		const env: Record<string, string | undefined> = {
			NIGHTSHIFT_DATA_DIR: dir(),
			HOME: home,
			PATH: "/usr/bin:/bin",
		};
		prepareDaemonEnv({
			port: 3100,
			url: "http://localhost:3100",
			uiOrigin: "http://localhost:3001",
			env,
		});
		expect(env.PATH).toBe(`${join(home, ".local/bin")}:/usr/bin:/bin`);
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

describe("the key that seals the Personal secrets a computer keeps (ADR 13)", () => {
	test("made once in the data directory, readable by this user only", () => {
		const dataDir = dir();
		const first = secretsKey({}, dataDir);
		expect(first.length).toBe(64);
		expect(secretsKey({}, dataDir)).toBe(first);
		const file = join(dataDir, SECRETS_KEY_FILE);
		expect(readFileSync(file, "utf8")).toBe(first);
		expect(statSync(file).mode & 0o777).toBe(0o600);
	});

	test("the environment, then a file, then the secrets folder, before the data directory", () => {
		const dataDir = dir();
		secretsKey({}, dataDir);
		expect(secretsKey({ NIGHTSHIFT_SECRETS_KEY: SECRET }, dataDir)).toBe(
			SECRET,
		);
		const given = join(dir(), "key");
		writeFileSync(given, `${SECRET}\n`);
		expect(secretsKey({ NIGHTSHIFT_SECRETS_KEY_FILE: given }, dataDir)).toBe(
			SECRET,
		);
		const folder = dir();
		writeFileSync(join(folder, "NIGHTSHIFT_SECRETS_KEY"), SECRET);
		expect(secretsKey({ NIGHTSHIFT_SECRETS_DIR: folder }, dataDir)).toBe(
			SECRET,
		);
		expect(() =>
			secretsKey({ NIGHTSHIFT_SECRETS_KEY: "short" }, dataDir),
		).toThrow("too short");
	});
});

describe("the auth secret of a daemon that varlock started", () => {
	test("BETTER_AUTH_SECRET wins, and nothing is logged", () => {
		const lines: string[] = [];
		const dataDir = dir();
		expect(
			daemonAuthSecret(
				{ NODE_ENV: "production", BETTER_AUTH_SECRET: SECRET },
				dataDir,
				(line) => lines.push(line),
			),
		).toBe(SECRET);
		expect(lines).toEqual([]);
		expect(existsSync(join(dataDir, AUTH_SECRET_FILE))).toBe(false);
	});

	test("production refuses to start without one", () => {
		const dataDir = dir();
		expect(() =>
			daemonAuthSecret({ NODE_ENV: "production" }, dataDir, () => {}),
		).toThrow("BETTER_AUTH_SECRET is not set");
		expect(() =>
			daemonAuthSecret(
				{ NODE_ENV: "production", BETTER_AUTH_SECRET: "  " },
				dataDir,
				() => {},
			),
		).toThrow("BETTER_AUTH_SECRET is not set");
		expect(existsSync(join(dataDir, AUTH_SECRET_FILE))).toBe(false);
	});

	test("development uses the dev default, kept, and says so once", () => {
		const lines: string[] = [];
		const dataDir = dir();
		const first = daemonAuthSecret(
			{ NODE_ENV: "development" },
			dataDir,
			(line) => lines.push(line),
		);
		expect(first.length).toBe(64);
		expect(daemonAuthSecret({}, dataDir, () => {})).toBe(first);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("dev default");
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

describe("who Web Push messages come from", () => {
	const env = (values: Record<string, string>) =>
		({
			BETTER_AUTH_SECRET: SECRET,
			BETTER_AUTH_URL: "http://localhost:3000",
			CORS_ORIGIN: "http://localhost:3001",
			...values,
		}) as DaemonEnv;

	test("a Host's public address", () => {
		expect(
			webPushSubject(env({ BETTER_AUTH_URL: "https://host.example.com/" })),
		).toBe("https://host.example.com");
		expect(webPushSubject(env({ CORS_ORIGIN: "https://ui.example.com" }))).toBe(
			"https://ui.example.com",
		);
	});

	test("never a local address", () => {
		expect(webPushSubject(env({}))).toBe(
			"https://github.com/xiduzo/nightshift",
		);
		expect(
			webPushSubject(env({ BETTER_AUTH_URL: "https://mac.local:3000" })),
		).toBe("https://github.com/xiduzo/nightshift");
	});
});
