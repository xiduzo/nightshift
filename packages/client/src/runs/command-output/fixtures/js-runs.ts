/** Invented outputs of the JavaScript test runners, shaped as they print them. */

export const BUN_RUN = `bun test v1.3.10 (30e609e0)

src/math.test.ts:
(pass) add > adds two numbers [0.12ms]
(pass) add > handles negatives [0.03ms]
1 | import { expect, test } from "bun:test";
2 | import { divide } from "./math";
3 | test("divide > throws on zero", () => {
4 |   expect(divide(1, 0)).toBe(0);
                           ^
error: expect(received).toBe(expected)

Expected: 0
Received: Infinity

      at <anonymous> (/work/shop/src/math.test.ts:4:24)
(fail) divide > throws on zero [1.20ms]

src/strings.test.ts:
(pass) trim > removes spaces [0.05ms]
(skip) trim > unicode
(todo) trim > tabs
TypeError: undefined is not an object (evaluating 'value.trim')
      at trim (/work/shop/src/strings.ts:2:15)
      at <anonymous> (/work/shop/src/strings.test.ts:9:9)
(fail) trim > keeps inner spaces [0.40ms]

2 tests failed:
(fail) divide > throws on zero [1.20ms]
(fail) trim > keeps inner spaces [0.40ms]

 3 pass
 1 skip
 1 todo
 2 fail
 6 expect() calls
Ran 7 tests across 2 files. [45.00ms]
`;

/** bun test piped, not on a terminal: only failed tests are listed. */
export const BUN_PIPED = `bun test v1.3.10 (30e609e0)

sample.test.ts:
error: expect(received).toBe(expected)

Expected: 0
Received: Infinity

(fail) math > divides [0.11ms]
1 | function trim(value: unknown) {
2 | 	return (value as string).trim();
             ^
TypeError: undefined is not an object (evaluating 'value.trim')
      at trim (/work/shop/sample.test.ts:2:10)
      at <anonymous> (/work/shop/sample.test.ts:15:29)
(fail) strings > trims [0.13ms]

 1 pass
 1 skip
 1 todo
 2 fail
 2 expect() calls
Ran 5 tests across 1 file. [8.00ms]
`;

/** bun test on a terminal: marks, not words. */
export const BUN_TTY = `\u001b[0m\u001b[1mbun test \u001b[0m\u001b[2mv1.3.10\u001b[0m

src/a.test.ts:
\u001b[32m✓\u001b[0m a > one \u001b[2m[0.10ms]\u001b[0m
\u001b[31m✗\u001b[0m a > two \u001b[2m[2.00ms]\u001b[0m
\u001b[33m»\u001b[0m a > three

 1 pass
 1 skip
 1 fail
Ran 3 tests across 1 file. [1.20s]
`;

/** bun test cut off while it still runs. */
export const BUN_PARTIAL = `bun test v1.3.10 (30e609e0)

src/queue.test.ts:
(pass) queue > takes in order [0.20ms]
(pass) queue > drains [0.10ms]

src/slow.test.ts:
(pass) slow > waits [1500.00ms]
`;

export const VITEST_RUN = `
 RUN  v2.1.8 /work/shop

 ✓ src/math.test.ts (3 tests) 5ms
 ❯ src/strings.test.ts (3 tests | 1 failed | 1 skipped) 8ms
   ✓ trim > removes spaces 1ms
   × trim > keeps inner spaces 3ms
     → expected 'a b' to be 'ab' // Object.is equality
   ↓ trim > unicode
 ↓ src/later.test.ts (2 tests | 2 skipped)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/strings.test.ts > trim > keeps inner spaces
AssertionError: expected 'a b' to be 'ab' // Object.is equality

- Expected
+ Received

- ab
+ a b

 ❯ src/strings.test.ts:9:22
      7|   test("keeps inner spaces", () => {
      8|     const value = "a b";
      9|     expect(trim(value)).toBe("ab");
       |                         ^
     10|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 1 passed | 1 skipped (3)
      Tests  1 failed | 4 passed | 3 skipped (8)
   Start at  10:12:01
   Duration  412ms (transform 30ms, setup 0ms, collect 40ms, tests 13ms, environment 0ms, prepare 120ms)
`;

/** Vitest's verbose reporter: a tree of groups and tests. */
export const VITEST_VERBOSE = `
 RUN  v2.1.8 /work/shop

 ✓ src/cart.test.ts (3)
   ✓ cart (3)
     ✓ totals (2)
       ✓ adds prices 1ms
       ✓ applies a discount
     ✓ empties

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  1.02s
`;

/** Vitest 3 prints a flat line per test with its file. */
export const VITEST_FLAT = `
 RUN  v3.0.4 /work/shop

 ✓ src/cart.test.ts > cart > adds prices 1ms
 × src/cart.test.ts > cart > rounds 2ms
   → expected 1.005 to be 1.01

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
   Duration  300ms
`;

export const VITEST_SUITE_FAILED = `
 RUN  v2.1.8 /work/shop

 ❯ src/broken.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/broken.test.ts [ src/broken.test.ts ]
Error: Cannot find module './missing' imported from /work/shop/src/broken.test.ts
 ❯ src/broken.test.ts:1:1

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  no tests
   Duration  210ms
`;

export const JEST_VERBOSE = `PASS src/math.test.js
  add
    ✓ adds two numbers (2 ms)
    ✓ handles negatives
FAIL src/strings.test.js (1.02 s)
  trim
    ✓ removes spaces (1 ms)
    ✕ keeps inner spaces (4 ms)
    ○ skipped unicode
    ✎ todo tabs

  ● trim › keeps inner spaces

    expect(received).toBe(expected) // Object.is equality

    Expected: "ab"
    Received: "a b"

       7 |   test("keeps inner spaces", () => {
    >  8 |     expect(trim("a b")).toBe("ab");
         |                         ^
       9 |   });

      at Object.toBe (src/strings.test.js:8:25)

Test Suites: 1 failed, 1 passed, 2 total
Tests:       1 failed, 1 skipped, 1 todo, 3 passed, 6 total
Snapshots:   0 total
Time:        1.234 s
Ran all test suites.
`;

/** Jest without --verbose: a line per file, failures only. */
export const JEST_QUIET = `PASS src/math.test.js
FAIL src/orders/total.test.ts
  ● orders › total › adds tax

    TypeError: Cannot read properties of undefined (reading 'rate')

      12 |   const order = makeOrder();
    > 13 |   expect(total(order)).toBe(110);
         |          ^

      at total (src/orders/total.ts:4:22)
      at Object.<anonymous> (src/orders/total.test.ts:13:10)
      at processTicksAndRejections (node:internal/process/task_queues:95:5)

  ● orders › total › rounds

    expect(received).toBe(expected)

      at Object.toBe (src/orders/total.test.ts:20:5)

Summary of all failing tests
FAIL src/orders/total.test.ts
  ● orders › total › adds tax

    TypeError: Cannot read properties of undefined (reading 'rate')

Test Suites: 1 failed, 1 passed, 2 total
Tests:       2 failed, 9 passed, 11 total
Snapshots:   0 total
Time:        3.4 s, estimated 4 s
`;

export const JEST_SUITE_FAILED = `FAIL src/broken.test.ts
  ● Test suite failed to run

    Cannot find module './missing' from 'src/broken.test.ts'

      at Resolver.resolveModule (node_modules/jest-resolve/build/resolver.js:324:11)

Test Suites: 1 failed, 1 total
Tests:       0 total
Snapshots:   0 total
Time:        0.5 s
`;
