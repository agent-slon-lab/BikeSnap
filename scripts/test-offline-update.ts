/**
 * Юнит-тест v1.14.46: НАСТОЯЩЕЕ офлайн-приложение в sw.js.
 *
 * Спека пользователя: «Vercel нужен только для обновы! У нас офлайн-прил!
 * Запрос на Vercel есть ответ — работаем. Нет — идём на ГХ, но самого
 * перехода делать НЕ НАДО — только скачать обновление. Если и ГХ молчит —
 * локально загружаем. Запросы по 1сек».
 *
 * Инварианты:
 *  1. Кэш есть → навигация мгновенно из кэша, НОЛЬ сетевых запросов.
 *  2. Кэша нет + origin жив → свежий HTML с этого origin, в кэш.
 *  3. Кэша нет + origin мёртв + зеркало живо → HTML зеркала показывается
 *     с ТЕКУЩЕГО адреса (кросс-доменный cors), БЕЗ перехода, в локальный кэш.
 *  4. Кэша нет + оба мертвы → Response.error.
 *  5. Обнова: Vercel жив и версия ≠ кэша → закачка HTML+ассетов+version.json
 *     (version.json — последним), сообщение UPDATE_DOWNLOADED.
 *  6. Версия совпала → закачки нет.
 *  7. Vercel мёртв + зеркало живо → закачка с зеркала.
 *  8. Оба мертвы → тихо, никаких закачек.
 *  9. fetchTimeout рвёт зависший fetch по таймауту.
 * 10. Зонды = 1 сек (PROBE_TIMEOUT_MS), редирект-кода в sw.js нет вовсе.
 *
 * sw.js исполняется в vm-песочнице. Запуск: npx tsx scripts/test-offline-update.ts
 */
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";

const MIRROR = "https://agent-slon-lab.github.io";
const VERCEL = "https://bike-snap.vercel.app";

let ok = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    ok++;
    console.log(`  OK   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

interface SandboxOpts {
  origin?: string;
  /** Жив ли Vercel-зонд /version.json (1с) */
  vercelAlive?: boolean;
  vercelVersion?: string;
  /** Жив ли зонд зеркала */
  mirrorAlive?: boolean;
  mirrorVersion?: string;
  /** Зависает ли вообще весь fetch (тест таймаута) */
  hangAll?: boolean;
  /** Начальное содержимое кэша: путь → Response */
  prePut?: Record<string, Response>;
  /** Ответ на строковый fetch ассета/HTML обновы */
  assetFetcher?: (url: string) => Promise<Response>;
}

interface RecordingCache {
  puts: Array<{ path: string; order: number }>;
  store: Map<string, Response>;
  putOrder: number;
}

function makeSandbox(opts: SandboxOpts = {}) {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "public", "sw.js"),
    "utf8"
  );
  const handlers: Record<string, Array<(e: unknown) => void>> = {};
  const waitPromises: Array<Promise<unknown>> = [];
  const fetchCalls: string[] = [];
  const posted: unknown[] = [];

  const cache: RecordingCache = {
    puts: [],
    store: new Map(Object.entries(opts.prePut ?? {})),
    putOrder: 0,
  };

  const sandboxFetch = (input: unknown): Promise<Response> => {
    if (opts.hangAll) return new Promise(() => {});
    const isString = typeof input === "string";
    const url = isString
      ? (input as string)
      : String((input as { url?: string })?.url ?? "");
    fetchCalls.push((isString ? "" : "REQUEST:") + url);
    // Зонд /version.json: сначала Vercel, потом зеркало
    if (url.includes("/version.json")) {
      if (url.startsWith(VERCEL)) {
        return opts.vercelAlive
          ? Promise.resolve(
              new Response(JSON.stringify({ version: opts.vercelVersion }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              })
            )
          : Promise.reject(new Error("vercel dead"));
      }
      if (url.startsWith(MIRROR)) {
        return opts.mirrorAlive
          ? Promise.resolve(
              new Response(JSON.stringify({ version: opts.mirrorVersion }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              })
            )
          : Promise.reject(new Error("mirror dead"));
      }
      return Promise.reject(new Error("unknown probe " + url));
    }
    // Ассеты/HTML обновы и навигация Request
    if (opts.assetFetcher) return opts.assetFetcher(url);
    return Promise.reject(new Error("network dead: " + url));
  };

  const sandbox: Record<string, unknown> = {
    self: {
      location: { origin: opts.origin ?? VERCEL },
      addEventListener: (name: string, cb: (e: unknown) => void) => {
        (handlers[name] ??= []).push(cb);
      },
      skipWaiting: () => Promise.resolve(),
      clients: {
        claim: () => Promise.resolve([]),
        matchAll: () => Promise.resolve([{ postMessage: (m: unknown) => posted.push(m) }]),
      },
    },
    fetch: sandboxFetch,
    caches: {
      open: async () => ({
        put: async (req: unknown, res: Response) => {
          const key =
            typeof req === "string"
              ? req
              : String((req as { url?: string })?.url ?? "");
          cache.store.set(key, res);
          cache.puts.push({ path: key, order: ++cache.putOrder });
        },
        add: async () => {},
      }),
      match: async (req: unknown) => {
        const key =
          typeof req === "string"
            ? req
            : String((req as { url?: string })?.url ?? "");
        return cache.store.get(key) ?? null;
      },
      keys: async () => [],
      delete: async () => true,
    },
    Response,
    Headers,
    Request,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
  };

  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  return { handlers, sandbox, cache, fetchCalls, posted, waitPromises };
}

interface FakeEvent {
  request: { url: string; mode: string; method: string };
  respondWith: (p: Promise<Response>) => void;
  waitUntil: (p: Promise<unknown>) => void;
}

async function runNavigation(
  handlers: Record<string, Array<(e: FakeEvent) => void>>,
  targetPath: string,
  origin: string = VERCEL,
  waitPromises?: Array<Promise<unknown>>
): Promise<Response | undefined> {
  let captured: Promise<Response> | undefined;
  const event: FakeEvent = {
    request: { url: origin + targetPath, mode: "navigate", method: "GET" },
    respondWith: (p) => {
      captured = p;
    },
    waitUntil: (p) => waitPromises?.push(p),
  };
  for (const cb of handlers["fetch"] ?? []) cb(event);
  if (!captured) return undefined;
  return captured;
}

async function main() {
  console.log("— v1.14.46 офлайн-приложение + загрузчик обновы (sw.js) —\n");

  // 0. Статические инварианты исходника
  {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "public", "sw.js"),
      "utf8"
    );
    check("10. зонд обновы = 1 сек", src.includes("PROBE_TIMEOUT_MS = 1000"));
    check(
      "10b. в sw.js нет редирект-кода (location.replace / meta refresh)",
      !src.includes("location.replace") && !src.includes("http-equiv")
    );
  }

  // 1. Кэш есть → мгновенно из кэша, НОЛЬ сетевых запросов
  {
    const { handlers, fetchCalls, waitPromises } = makeSandbox({
      prePut: { "/": new Response("<html>cached-shell</html>", { status: 200 }) },
    });
    const res = (await runNavigation(handlers, "/", VERCEL, waitPromises))!;
    const body = await res.text();
    await Promise.allSettled(waitPromises);
    check("1. кэш → офлайн-оболочка", body.includes("cached-shell"));
    check(
      "1b. сама навигация — ноль сетевых запросов (зонд обновы в фоне не в счёт)",
      fetchCalls.filter((u) => u.startsWith("REQUEST:")).length === 0,
      `запросов-навигаций: ${fetchCalls.filter((u) => u.startsWith("REQUEST:")).length}`
    );
  }

  // 2. Кэша нет, origin жив → свежий HTML, сохранён в кэш
  {
    const { handlers, cache, waitPromises } = makeSandbox({
      assetFetcher: async () =>
        new Response("<html>fresh-shell</html>", { status: 200 }),
    });
    const res = (await runNavigation(handlers, "/", VERCEL, waitPromises))!;
    const body = await res.text();
    await Promise.allSettled(waitPromises);
    check("2. первый визит, origin жив → свежий HTML", body.includes("fresh-shell"));
    check("2b. HTML сохранён в локальный кэш", cache.store.has("/"));
  }

  // 3. Кэша нет, origin мёртв, зеркало живо → HTML зеркала БЕЗ перехода
  {
    const { handlers, cache } = makeSandbox({
      assetFetcher: async (url) => {
        if (url.startsWith(MIRROR)) {
          return new Response("<html>mirror-fresh-shell</html>", { status: 200 });
        }
        return Promise.reject(new Error("dead " + url));
      },
    });
    const res = (await runNavigation(handlers, "/"))!;
    const body = await res.text();
    check(
      "3. origin мёртв + зеркало живо → HTML зеркала с текущего адреса",
      body.includes("mirror-fresh-shell")
    );
    check(
      "3b. БЕЗ редиректа/перехода",
      !body.includes("location.replace") && !body.includes("http-equiv")
    );
    check("3c. HTML зеркала положен в локальный кэш", cache.store.has("/"));
  }

  // 4. Кэша нет, оба мертвы → Response.error
  {
    const { handlers } = makeSandbox({});
    const res = (await runNavigation(handlers, "/"))!;
    check("4. оба мертвы + кэш пуст → error-response", res.status === 0);
  }

  // 5. Обнова: Vercel жив, версия отличается → закачка целиком
  {
    const { sandbox, cache, posted } = makeSandbox({
      vercelAlive: true,
      vercelVersion: "v9.9.9",
      prePut: {
        "/version.json": new Response(JSON.stringify({ version: "v0.0.1" }), {
          status: 200,
        }),
      },
      assetFetcher: async (url) => {
        if (url === VERCEL + "/") {
          return new Response(
            '<html><script src="/_next/static/chunks/main-abc.js"></script>' +
              '<link href=\\"\\/_next\\/static\\/css\\/app-1.css\\" rel="stylesheet"></html>',
            { status: 200, headers: { "Content-Type": "text/html" } }
          );
        }
        if (url.endsWith("main-abc.js")) {
          return new Response(
            'import"/_next/static/media/font-x.woff2";',
            { status: 200, headers: { "Content-Type": "text/javascript" } }
          );
        }
        if (url.endsWith("app-1.css")) {
          return new Response("body{}", {
            status: 200,
            headers: { "Content-Type": "text/css" },
          });
        }
        if (url.endsWith("font-x.woff2")) {
          return new Response("woff2bin", { status: 200 });
        }
        return new Response("{}", { status: 404 });
      },
    });
    await (sandbox.checkForUpdate as (t: string) => Promise<void>)("test");
    const paths = cache.puts.map((p) => p.path);
    check("5. HTML обновы в кэше", paths.includes("/"));
    check("5b. чанк JS в кэше", paths.some((p) => p.includes("main-abc.js")));
    check("5c. CSS (экранированный путь) в кэше", paths.some((p) => p.includes("app-1.css")));
    check("5d. вложенный шрифт в кэше", paths.some((p) => p.includes("font-x.woff2")));
    const verPut = cache.puts.find((p) => p.path === "/version.json");
    const lastOrder = Math.max(...cache.puts.map((p) => p.order));
    check(
      "5e. version.json кладётся ПОСЛЕДНИМ (флаг полной закачки)",
      !!verPut && verPut.order === lastOrder
    );
    const msg = posted.find((m) => (m as { type?: string })?.type === "UPDATE_DOWNLOADED");
    check(
      "5f. страницам ушло UPDATE_DOWNLOADED v9.9.9",
      !!msg && (msg as { version?: string }).version === "v9.9.9"
    );
  }

  // 6. Версия совпала → закачки нет
  {
    const { sandbox, cache, posted, fetchCalls } = makeSandbox({
      vercelAlive: true,
      vercelVersion: "v9.9.9",
      prePut: {
        "/version.json": new Response(JSON.stringify({ version: "v9.9.9" }), {
          status: 200,
        }),
      },
      assetFetcher: async () => new Response("x", { status: 200 }),
    });
    await (sandbox.checkForUpdate as (t: string) => Promise<void>)("test");
    check("6. версия совпала → ноль закачек", cache.puts.length === 0);
    check("6b. и никаких сообщений странице", posted.length === 0);
    check(
      "6c. был только зонд version.json",
      fetchCalls.filter((u) => u.includes("/version.json")).length >= 1 &&
        fetchCalls.length <= 2
    );
  }

  // 7. Vercel мёртв + зеркало живо → закачка с зеркала
  {
    const { sandbox, cache, fetchCalls } = makeSandbox({
      vercelAlive: false,
      mirrorAlive: true,
      mirrorVersion: "v8.8.8",
      prePut: {
        "/version.json": new Response(JSON.stringify({ version: "v0.0.1" }), {
          status: 200,
        }),
      },
      assetFetcher: async (url) => {
        if (url === MIRROR + "/") {
          return new Response(
            '<html><script src="/_next/static/chunks/m.js"></script></html>',
            { status: 200, headers: { "Content-Type": "text/html" } }
          );
        }
        return new Response("chunk", { status: 200 });
      },
    });
    await (sandbox.checkForUpdate as (t: string) => Promise<void>)("test");
    const assetCalls = fetchCalls.filter(
      (u) => !u.includes("/version.json") && u.startsWith(MIRROR)
    );
    check("7. обнова скачана с зеркала (Vercel мёртв)", assetCalls.length >= 2);
    check(
      "7b. ни один ассет не тянулся с Vercel",
      fetchCalls.every((u) => !u.startsWith(VERCEL) || u.includes("/version.json"))
    );
    check("7c. HTML зеркала в локальном кэше", cache.store.has("/"));
  }

  // 8. Оба мертвы → тихо, никаких закачек
  {
    const { sandbox, cache, posted } = makeSandbox({
      vercelAlive: false,
      mirrorAlive: false,
    });
    await (sandbox.checkForUpdate as (t: string) => Promise<void>)("test");
    check("8. оба мертвы → ноль закачек", cache.puts.length === 0);
    check("8b. ноль сообщений", posted.length === 0);
  }

  // 9. fetchTimeout рвёт зависший fetch
  {
    const { sandbox } = makeSandbox({ hangAll: true });
    const fn = sandbox.fetchTimeout as (
      u: string,
      t: number
    ) => Promise<Response>;
    const t0 = Date.now();
    let rejected = false;
    await fn("https://example.com/x", 80).catch(() => {
      rejected = true;
    });
    const elapsed = Date.now() - t0;
    check(
      "9. зависший fetch оборван по таймауту",
      rejected && elapsed >= 60 && elapsed < 1000,
      `rejected=${rejected}, elapsed=${elapsed}ms`
    );
  }

  console.log(`\nИтог: ${ok} OK / ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Тест упал:", e);
  process.exit(1);
});
