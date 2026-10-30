/** Invented crashes, shaped as each runtime prints them. */

export const NODE_TRACE = `> shop@1.0.0 start
> node src/main.js

/work/shop/src/users.js:12
  return user.profile.id;
                      ^

TypeError: Cannot read properties of undefined (reading 'id')
    at getUser (/work/shop/src/users.js:12:23)
    at async handler (file:///work/shop/src/routes.js:40:5)
    at Layer.handle [as handle_request] (/work/shop/node_modules/express/lib/router/layer.js:95:5)
    at next (/work/shop/node_modules/express/lib/router/route.js:149:13)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
    at new Promise (<anonymous>)
    at /work/shop/src/main.js:3:1

Node.js v22.11.0
`;

export const NODE_CODE_ERROR = `node:internal/modules/cjs/loader:1228
  throw err;
  ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/work/shop/src/missing.js'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)
    at Module._load (node:internal/modules/cjs/loader:1051:27)
`;

export const BUN_TRACE = `1 | export function total(order) {
2 |   return order.items.reduce((sum, item) => sum + item.price, 0);
                   ^
TypeError: undefined is not an object (evaluating 'order.items.reduce')
      at total (/work/shop/src/orders.ts:2:16)
      at <anonymous> (/work/shop/src/main.ts:5:13)
      at processTicksAndRejections (native:7:39)

Bun v1.3.10 (macOS arm64)
`;

export const BUN_PLAIN_ERROR = `error: Unable to connect to the database
      at connect (/work/shop/src/db.ts:20:11)
      at /work/shop/src/main.ts:2:7
`;

export const PYTHON_TRACE = `Starting import...
Traceback (most recent call last):
  File "/work/shop/app/main.py", line 10, in <module>
    main()
  File "/work/shop/app/main.py", line 6, in main
    data = load(path)
           ^^^^^^^^^^
  File "/work/shop/.venv/lib/python3.12/site-packages/yaml/__init__.py", line 79, in load
    return loader.get_single_data()
  File "/work/shop/app/config.py", line 22, in parse
    port = int(value)
ValueError: invalid literal for int() with base 10: 'eighty'
`;

export const PYTHON_CHAINED = `Traceback (most recent call last):
  File "/work/shop/app/config.py", line 8, in read
    return open(path).read()
FileNotFoundError: [Errno 2] No such file or directory: 'shop.toml'

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "/work/shop/app/main.py", line 4, in <module>
    read("shop.toml")
  File "/work/shop/app/config.py", line 10, in read
    raise ConfigError("Config missing") from err
app.config.ConfigError: Config missing
`;

export const JAVA_TRACE = `Exception in thread "main" java.lang.IllegalStateException: Config missing
	at com.example.shop.App.load(App.kt:12)
	at com.example.shop.App.main(App.kt:5)
	at java.base/java.lang.Thread.run(Thread.java:1583)
Caused by: java.io.FileNotFoundException: shop.yml (No such file or directory)
	at java.base/java.io.FileInputStream.open0(Native Method)
	at java.base/java.io.FileInputStream.open(FileInputStream.java:213)
	at com.example.shop.Config.read(Config.kt:30)
	... 2 more
`;

export const KOTLIN_COROUTINE_TRACE = `kotlin.UninitializedPropertyAccessException: lateinit property repo has not been initialized
	at com.example.shop.OrderService.getRepo(OrderService.kt:9)
	at com.example.shop.OrderService$place$1.invokeSuspend(OrderService.kt:21)
	at kotlin.coroutines.jvm.internal.BaseContinuationImpl.resumeWith(ContinuationImpl.kt:33)
	at kotlinx.coroutines.DispatchedTask.run(DispatchedTask.kt:108)
`;

export const GO_TRACE = `starting shop on :8080
panic: runtime error: index out of range [5] with length 3

goroutine 1 [running]:
main.lookup(...)
	/work/shop/main.go:12
main.main()
	/work/shop/main.go:20 +0x1d
exit status 2
`;

export const GO_MODULE_TRACE = `panic: assignment to entry in nil map

goroutine 18 [running]:
example.com/shop/cart.(*Cart).Add(0x14000110000, {0x1003a4b2c, 0x5})
	/work/shop/cart/cart.go:31 +0x50
github.com/acme/router.(*Mux).ServeHTTP(0x140000a2000, {0x1003f8e10, 0x140001c2000}, 0x14000198000)
	/home/dev/go/pkg/mod/github.com/acme/router@v1.2.0/mux.go:88 +0x2a0
net/http.serverHandler.ServeHTTP({0x140000b8000?}, {0x1003f8e10?, 0x140001c2000?}, 0x6?)
	/usr/local/go/src/net/http/server.go:3210 +0xbc
created by net/http.(*Server).Serve in goroutine 1
	/usr/local/go/src/net/http/server.go:3360 +0x3dc
`;
