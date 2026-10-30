/** Invented outputs of pytest, Gradle, Maven, go test and cargo test, shaped as they print them. */

export const PYTEST_RUN = `============================= test session starts ==============================
platform linux -- Python 3.12.1, pytest-8.3.2, pluggy-1.5.0
rootdir: /work/shop
collected 6 items

tests/test_math.py ..F                                                   [ 50%]
tests/test_strings.py .sx                                                [100%]

=================================== FAILURES ===================================
_________________________________ test_divide __________________________________

    def test_divide():
>       assert divide(1, 0) == 0

tests/test_math.py:12:
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _

    def divide(a, b):
>       return a / b
E       ZeroDivisionError: division by zero

shop/math.py:3: ZeroDivisionError
=========================== short test summary info ============================
FAILED tests/test_math.py::test_divide - ZeroDivisionError: division by zero
==================== 1 failed, 3 passed, 1 skipped, 1 xfailed in 0.12s ====================
`;

export const PYTEST_VERBOSE = `============================= test session starts ==============================
collected 3 items

tests/test_cart.py::TestCart::test_total PASSED                          [ 33%]
tests/test_cart.py::TestCart::test_discount[10-90] FAILED                [ 66%]
tests/test_cart.py::test_empty SKIPPED (no shop yet)                     [100%]

=================================== FAILURES ===================================
_______________________ TestCart.test_discount[10-90] ________________________

self = <tests.test_cart.TestCart object at 0x7f>

    def test_discount(self, percent, expected):
>       assert apply(100, percent) == expected
E       assert 91 == 90
E        +  where 91 = apply(100, 10)

tests/test_cart.py:21: AssertionError
=========================== short test summary info ============================
FAILED tests/test_cart.py::TestCart::test_discount[10-90] - assert 91 == 90
==================== 1 failed, 1 passed, 1 skipped in 0.05s ====================
`;

export const PYTEST_COLLECTION_ERROR = `============================= test session starts ==============================
collected 0 items / 1 error

==================================== ERRORS ====================================
____________________ ERROR collecting tests/test_broken.py _____________________
ImportError while importing test module '/work/shop/tests/test_broken.py'.
E   ModuleNotFoundError: No module named 'shop.missing'
=========================== short test summary info ============================
ERROR tests/test_broken.py
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
=============================== 1 error in 0.08s ===============================
`;

export const GRADLE_RUN = `> Task :compileKotlin UP-TO-DATE
> Task :compileTestKotlin
> Task :test

CalculatorTest > adds two numbers() PASSED

CalculatorTest > divides by zero() FAILED
    org.opentest4j.AssertionFailedError: expected: <0> but was: <1>
        at app//org.junit.jupiter.api.AssertionUtils.fail(AssertionUtils.java:55)
        at app//org.junit.jupiter.api.Assertions.assertEquals(Assertions.java:150)
        at app//com.example.CalculatorTest.divides by zero(CalculatorTest.kt:21)

StringsTest > Trim > keeps inner spaces() SKIPPED

5 tests completed, 1 failed, 1 skipped

> Task :test FAILED

FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':test'.
> There were failing tests. See the report at: file:///work/shop/build/reports/tests/test/index.html

BUILD FAILED in 1m 4s
4 actionable tasks: 2 executed, 2 up-to-date
`;

export const MAVEN_RUN = `[INFO] Scanning for projects...
[INFO]
[INFO] -------------------------------------------------------
[INFO]  T E S T S
[INFO] -------------------------------------------------------
[INFO] Running com.example.CalculatorTest
[ERROR] Tests run: 3, Failures: 1, Errors: 0, Skipped: 1, Time elapsed: 0.045 s <<< FAILURE! -- in com.example.CalculatorTest
[ERROR] com.example.CalculatorTest.dividesByZero -- Time elapsed: 0.010 s <<< FAILURE!
org.opentest4j.AssertionFailedError: expected: <0> but was: <1>
	at org.junit.jupiter.api.AssertionUtils.fail(AssertionUtils.java:55)
	at com.example.CalculatorTest.dividesByZero(CalculatorTest.java:21)

[INFO] Running com.example.StringsTest
[INFO] Tests run: 2, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.012 s -- in com.example.StringsTest
[INFO]
[INFO] Results:
[INFO]
[ERROR] Failures:
[ERROR]   CalculatorTest.dividesByZero:21 expected: <0> but was: <1>
[INFO]
[ERROR] Tests run: 5, Failures: 1, Errors: 0, Skipped: 1
[INFO]
[INFO] ------------------------------------------------------------------------
[INFO] BUILD FAILURE
[INFO] ------------------------------------------------------------------------
[INFO] Total time:  01:05 min
`;

/** Surefire 2 names a failed test `method(Class)`. */
export const MAVEN_OLD = `-------------------------------------------------------
 T E S T S
-------------------------------------------------------
Running com.example.OrderTest
Tests run: 2, Failures: 0, Errors: 1, Skipped: 0, Time elapsed: 0.05 sec <<< FAILURE! - in com.example.OrderTest
totals(com.example.OrderTest)  Time elapsed: 0.01 sec  <<< ERROR!
java.lang.NullPointerException
	at com.example.Order.total(Order.java:14)
	at com.example.OrderTest.totals(OrderTest.java:9)


Results :

Tests in error:
  OrderTest.totals:9 NullPointer

Tests run: 2, Failures: 0, Errors: 1, Skipped: 0
`;

export const GO_RUN = `--- FAIL: TestDivide (0.00s)
    calc_test.go:14: expected 0, got 1
--- FAIL: TestParse (0.01s)
    --- FAIL: TestParse/empty (0.00s)
        parse_test.go:22: want error, got nil
FAIL
FAIL	example.com/shop/calc	0.012s
ok  	example.com/shop/strings	0.004s
?   	example.com/shop/cmd	[no test files]
FAIL
`;

export const GO_VERBOSE = `=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
=== RUN   TestDivide
    calc_test.go:14: expected 0, got 1
--- FAIL: TestDivide (0.00s)
=== RUN   TestLater
    calc_test.go:20: not ready
--- SKIP: TestLater (0.00s)
FAIL
exit status 1
FAIL	example.com/shop/calc	0.010s
`;

export const GO_PANIC_RUN = `=== RUN   TestLookup
--- FAIL: TestLookup (0.00s)
panic: runtime error: index out of range [5] with length 3 [recovered]
	panic: runtime error: index out of range [5] with length 3

goroutine 7 [running]:
testing.tRunner.func1.2({0x1029a2f40, 0x14000126018})
	/usr/local/go/src/testing/testing.go:1632 +0x1bc
panic({0x1029a2f40?, 0x14000126018?})
	/usr/local/go/src/runtime/panic.go:785 +0x124
example.com/shop/calc.Lookup(...)
	/work/shop/calc/calc.go:12
example.com/shop/calc.TestLookup(0x140001304e0?)
	/work/shop/calc/calc_test.go:30 +0x1c
FAIL	example.com/shop/calc	0.008s
FAIL
`;

export const CARGO_RUN = `   Compiling shop v0.1.0 (/work/shop)
    Finished \`test\` profile [unoptimized + debuginfo] target(s) in 0.52s
     Running unittests src/lib.rs (target/debug/deps/shop-1a2b3c4d)

running 3 tests
test tests::adds ... ok
test tests::divides ... FAILED
test tests::slow ... ignored

failures:

---- tests::divides stdout ----

thread 'tests::divides' panicked at src/lib.rs:20:9:
assertion \`left == right\` failed
  left: 1
 right: 0
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace


failures:
    tests::divides

test result: FAILED. 1 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.01s

     Running tests/api.rs (target/debug/deps/api-5e6f7a8b)

running 2 tests
test lists_orders ... ok
test creates_order ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s

   Doc-tests shop

running 1 test
test src/lib.rs - add (line 5) ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.30s

error: test failed, to rerun pass \`--lib\`
`;
