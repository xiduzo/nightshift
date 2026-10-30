import { describe, expect, test } from "bun:test";

import { BUN_RUN, JEST_QUIET } from "./fixtures/js-runs";
import { GRADLE_RUN } from "./fixtures/other-runs";
import {
	BUN_PLAIN_ERROR,
	BUN_TRACE,
	GO_MODULE_TRACE,
	GO_TRACE,
	JAVA_TRACE,
	KOTLIN_COROUTINE_TRACE,
	NODE_CODE_ERROR,
	NODE_TRACE,
	PYTHON_CHAINED,
	PYTHON_TRACE,
} from "./fixtures/traces";
import { parseStackTrace, type StackTrace } from "./stack-trace";

function parsed(text: string): StackTrace {
	const trace = parseStackTrace(text);
	if (!trace) throw new Error("expected a stack trace");
	return trace;
}

/** Each frame as `fn file:line:column`, with `*` before an internal one. */
const frames = (trace: Pick<StackTrace, "frames">) =>
	trace.frames.map(
		(frame) =>
			`${frame.internal ? "*" : ""}${frame.fn ?? "-"} ${frame.file ?? "-"}:${frame.line ?? "-"}:${frame.column ?? "-"}`,
	);

describe("no stack trace", () => {
	test("plain output gives null", () => {
		expect(parseStackTrace("")).toBeNull();
		expect(parseStackTrace("Compiled 12 files.\nDone in 1.2s\n")).toBeNull();
		expect(parseStackTrace("Error: something went wrong\n")).toBeNull();
	});

	test("prose with `at` gives null", () => {
		expect(
			parseStackTrace(
				"We met at home (8:30) and\n  at the office (see notes)\n",
			),
		).toBeNull();
		expect(parseStackTrace("  at least one file changed\n")).toBeNull();
	});

	test("a panic without a goroutine trace gives null", () => {
		expect(parseStackTrace("panic: boom\n")).toBeNull();
	});
});

describe("V8: Node and Bun", () => {
	test("reads the error above the frames and every frame form", () => {
		const trace = parsed(NODE_TRACE);
		expect(trace.language).toBe("javascript");
		expect(trace.error).toEqual({
			type: "TypeError",
			message: "Cannot read properties of undefined (reading 'id')",
		});
		expect(frames(trace)).toEqual([
			"getUser /work/shop/src/users.js:12:23",
			"handler /work/shop/src/routes.js:40:5",
			"*Layer.handle [as handle_request] /work/shop/node_modules/express/lib/router/layer.js:95:5",
			"*next /work/shop/node_modules/express/lib/router/route.js:149:13",
			"*processTicksAndRejections node:internal/process/task_queues:95:5",
			"*new Promise -:-:-",
			"- /work/shop/src/main.js:3:1",
		]);
		expect(trace.frames[0]?.text).toBe(
			"at getUser (/work/shop/src/users.js:12:23)",
		);
	});

	test("an error code in brackets stays out of the type", () => {
		const trace = parsed(NODE_CODE_ERROR);
		expect(trace.error).toEqual({
			type: "Error",
			message: "Cannot find module '/work/shop/src/missing.js'",
		});
		expect(trace.frames.every((frame) => frame.internal)).toBe(true);
	});

	test("reads Bun's format, code frame left out", () => {
		const trace = parsed(BUN_TRACE);
		expect(trace.error).toEqual({
			type: "TypeError",
			message: "undefined is not an object (evaluating 'order.items.reduce')",
		});
		expect(frames(trace)).toEqual([
			"total /work/shop/src/orders.ts:2:16",
			"<anonymous> /work/shop/src/main.ts:5:13",
			"*processTicksAndRejections native:7:39",
		]);
	});

	test("Bun's `error:` has no type", () => {
		const trace = parsed(BUN_PLAIN_ERROR);
		expect(trace.error).toEqual({
			message: "Unable to connect to the database",
		});
		expect(trace.frames).toHaveLength(2);
	});

	test("finds the first trace in a test run", () => {
		const trace = parsed(BUN_RUN);
		expect(trace.error.message).toContain("expect(received).toBe(expected)");
		expect(frames(trace)).toEqual([
			"<anonymous> /work/shop/src/math.test.ts:4:24",
		]);
		const jest = parsed(JEST_QUIET);
		expect(jest.error.type).toBe("TypeError");
		expect(jest.frames).toHaveLength(3);
	});
});

describe("Python", () => {
	test("reads frames innermost first, with the exception last", () => {
		const trace = parsed(PYTHON_TRACE);
		expect(trace.language).toBe("python");
		expect(trace.error).toEqual({
			type: "ValueError",
			message: "invalid literal for int() with base 10: 'eighty'",
		});
		expect(frames(trace)).toEqual([
			"parse /work/shop/app/config.py:22:-",
			"*load /work/shop/.venv/lib/python3.12/site-packages/yaml/__init__.py:79:-",
			"main /work/shop/app/main.py:6:-",
			"<module> /work/shop/app/main.py:10:-",
		]);
	});

	test("a chained exception is the error, the earlier one its cause", () => {
		const trace = parsed(PYTHON_CHAINED);
		expect(trace.error).toEqual({
			type: "app.config.ConfigError",
			message: "Config missing",
		});
		expect(trace.frames.map((frame) => frame.fn)).toEqual(["read", "<module>"]);
		expect(trace.causes).toHaveLength(1);
		expect(trace.causes?.[0]?.error).toEqual({
			type: "FileNotFoundError",
			message: "[Errno 2] No such file or directory: 'shop.toml'",
		});
	});

	test("an exception without a message has only a type", () => {
		const trace = parsed(
			'Traceback (most recent call last):\n  File "/work/shop/run.py", line 3, in <module>\n    wait()\nKeyboardInterrupt\n',
		);
		expect(trace.error).toEqual({ type: "KeyboardInterrupt", message: "" });
	});
});

describe("JVM: Java and Kotlin", () => {
	test("reads the thread line, frames, modules and causes", () => {
		const trace = parsed(JAVA_TRACE);
		expect(trace.language).toBe("jvm");
		expect(trace.error).toEqual({
			type: "java.lang.IllegalStateException",
			message: "Config missing",
		});
		expect(frames(trace)).toEqual([
			"com.example.shop.App.load App.kt:12:-",
			"com.example.shop.App.main App.kt:5:-",
			"*java.lang.Thread.run Thread.java:1583:-",
		]);
		expect(trace.causes?.[0]?.error).toEqual({
			type: "java.io.FileNotFoundException",
			message: "shop.yml (No such file or directory)",
		});
		expect(frames(trace.causes?.[0] as StackTrace)).toEqual([
			"*java.io.FileInputStream.open0 -:-:-",
			"*java.io.FileInputStream.open FileInputStream.java:213:-",
			"com.example.shop.Config.read Config.kt:30:-",
		]);
	});

	test("marks Kotlin and coroutine frames internal", () => {
		const trace = parsed(KOTLIN_COROUTINE_TRACE);
		expect(trace.error.type).toBe(
			"kotlin.UninitializedPropertyAccessException",
		);
		expect(trace.frames.map((frame) => frame.internal)).toEqual([
			false,
			false,
			true,
			true,
		]);
		expect(trace.frames[1]?.fn).toBe(
			"com.example.shop.OrderService$place$1.invokeSuspend",
		);
	});

	test("reads a Gradle test failure, names with spaces and all", () => {
		const trace = parsed(GRADLE_RUN);
		expect(trace.error).toEqual({
			type: "org.opentest4j.AssertionFailedError",
			message: "expected: <0> but was: <1>",
		});
		expect(frames(trace)).toEqual([
			"*org.junit.jupiter.api.AssertionUtils.fail AssertionUtils.java:55:-",
			"*org.junit.jupiter.api.Assertions.assertEquals Assertions.java:150:-",
			"com.example.CalculatorTest.divides by zero CalculatorTest.kt:21:-",
		]);
	});
});

describe("Go", () => {
	test("reads the panic and the panicking goroutine", () => {
		const trace = parsed(GO_TRACE);
		expect(trace.language).toBe("go");
		expect(trace.error).toEqual({
			type: "panic",
			message: "runtime error: index out of range [5] with length 3",
		});
		expect(frames(trace)).toEqual([
			"main.lookup /work/shop/main.go:12:-",
			"main.main /work/shop/main.go:20:-",
		]);
	});

	test("marks the standard library and module cache internal", () => {
		const trace = parsed(GO_MODULE_TRACE);
		expect(trace.error.message).toBe("assignment to entry in nil map");
		expect(frames(trace)).toEqual([
			"example.com/shop/cart.(*Cart).Add /work/shop/cart/cart.go:31:-",
			"*github.com/acme/router.(*Mux).ServeHTTP /home/dev/go/pkg/mod/github.com/acme/router@v1.2.0/mux.go:88:-",
			"*net/http.serverHandler.ServeHTTP /usr/local/go/src/net/http/server.go:3210:-",
			"*created by net/http.(*Server).Serve /usr/local/go/src/net/http/server.go:3360:-",
		]);
	});
});

describe("large outputs", () => {
	test("finds a crash at the end of a long log, fast", () => {
		const log = Array.from(
			{ length: 80_000 },
			(_, i) => `GET /items/${i} 200 3ms`,
		).join("\n");
		const started = performance.now();
		const trace = parsed(`${log}\n${NODE_TRACE}`);
		expect(performance.now() - started).toBeLessThan(500);
		expect(trace.error.type).toBe("TypeError");
	});

	test("keeps no more than 200 frames", () => {
		const deep = Array.from(
			{ length: 5000 },
			(_, i) => `    at walk (/work/shop/src/tree.js:${i + 1}:3)`,
		).join("\n");
		const trace = parsed(
			`RangeError: Maximum call stack size exceeded\n${deep}\n`,
		);
		expect(trace.frames).toHaveLength(200);
	});
});
