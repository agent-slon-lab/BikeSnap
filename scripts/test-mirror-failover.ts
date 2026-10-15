/**
 * Юнит-тест v1.14.39: зеркальный фейловер навигации в sw.js.
 *
 * Спека пользователя: «если vercel-домен недоступен — идём на ГХ, там новая
 * версия сразу подгружается. И только потом если эти два варианта сдохли
 * (инета нет) — офлайн загружаемся».
 *
 * Лестница: 1) сеть этого origin → 2) живое зеркало agent-slon-lab.github.io
 * → 3) офлайн-кэш. HTTP !ok (окно пропагации деплоя) — кэш, без редиректа.
 * На самом зеркале редиректа нет (защита от цикла).
 *
 * sw.js исполняется в vm-песочнице (глобалы: self/fetch/caches/Response…),
 * fetch-обработчик вызывается на синтетическом event. Body redirect-страницы
 * проверяется на target с сохранением пути и query.
 *
 * Запуск: npx tsx scripts/test-mirror-failover.ts
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

/** Контейнер результата respondWith. */
interface CapturedEvent {
  request: { url: string; mode: string; method: string };
  respondWith: (p: Promise<Response>) => void;
}

interface SandboxOpts {
  origin?: string;
  /** Поведение fetch до «своего» origin */
  fetchBehavior: "network-dead" | "network-ok" | "network-503";
  /** Отвечает ли зеркало на зонд probeAlive */
  mirrorAlive: boolean;
  /** Что отдаёт caches.match("/") */
  cacheHit?: Response | null;
  /** Зависает ли зонд зеркала (для теста таймаута probeAlive) */
  mirrorHangs?: boolean;
}

function makeSandbox(opts: SandboxOpts) {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "public", "sw.js"),
    "utf8"
  );
  const handlers: Record<string, Array<(e: CapturedEvent) => void>> = {};

  const okResponse = () => new Response("<html>fresh-shell</html>", { status: 200 });
  const badResponse = () => new Response("deploy-window-503", { status: 503 });

  const sandboxFetch = (input: unknown): Promise<unknown> => {
    // Зонд probeAlive вызывается fetch(СТРОКА-url, {mode:"no-cors"}),
    // навигация — fetch(объект Request). Различаем по типу аргумента.
    if (typeof input === "string") {
      if (opts.mirrorHangs) return new Promise(() => {});
      return opts.mirrorAlive
        ? Promise.resolve({ ok: false, type: "opaque", status: 0 })
        : Promise.reject(new Error("mirror dead"));
    }
    if (opts.fetchBehavior === "network-ok") return Promise.resolve(okResponse());
    if (opts.fetchBehavior === "network-503") return Promise.resolve(badResponse());
    return Promise.reject(new Error("network dead"));
  };

  const cachedShell = new Response("<html>cached-old-shell</html>", { status: 200 });

  const sandbox: Record<string, unknown> = {
    self: {
      location: { origin: opts.origin ?? VERCEL },
      addEventListener: (name: string, cb: (e: CapturedEvent) => void) => {
        (handlers[name] ??= []).push(cb);
      },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve([]) },
    },
    fetch: sandboxFetch,
    caches: {
      open: async () => ({ put: async () => {}, add: async () => {} }),
      match: async (req: unknown) => {
        const key =
          typeof req === "string"
            ? req
            : String((req as { url?: string })?.url ?? "");
        return key === "/" && opts.cacheHit ? opts.cacheHit : null;
      },
      keys: async () => [],
      delete: async () => true,
    },
    Response,
    Headers,
    Request,
    URL,
    setTimeout,
    clearTimeout,
    console,
  };

  vm.createContext(sandbox);
  try {
    vm.runInContext(src, sandbox);
  } catch (e) {
    console.error("ОШИБКА ИСПОЛНЕНИЯ sw.js В ПЕСОЧНИЦЕ:", e);
    throw e;
  }
  if (!handlers["fetch"]) {
    console.error(
      "ДИАГНОСТИКА: обработчики в песочнице:",
      Object.keys(handlers)
    );
  }
  return { handlers, sandbox, cachedShell };
}

/** Прогнать навигацию через fetch-обработчик sw.js (URL строится по origin). */
async function runNavigation(
  handlers: Record<string, Array<(e: CapturedEvent) => void>>,
  targetPath: string,
  origin: string = VERCEL
): Promise<Response | undefined> {
  let captured: Promise<Response> | undefined;
  const event: CapturedEvent = {
    request: {
      url: origin + targetPath,
      mode: "navigate",
      method: "GET",
    },
    respondWith: (p) => {
      captured = p;
    },
  };
  for (const cb of handlers["fetch"] ?? []) cb(event);
  if (!captured) return undefined;
  return captured;
}

async function main() {
  console.log("— v1.14.39 зеркальный фейловер навигации (sw.js) —\n");

  // 1. vercel недоступен, зеркало живое → авто-переход на зеркало
  {
    const { handlers } = makeSandbox({
      fetchBehavior: "network-dead",
      mirrorAlive: true,
      cacheHit: null,
    });
    const res = (await runNavigation(handlers, "/"))!;
    const body = await res.text();
    check(
      "1. vercel мёртв + зеркало живо → HTML-редиректор на зеркало",
      body.includes(MIRROR) && body.includes("location.replace"),
      body.slice(0, 80)
    );
    check(
      "1b. редиректор — это text/html 200",
      res.headers.get("content-type")?.includes("text/html") === true &&
        res.status === 200
    );
  }

  // 2. Путь и query сохраняются
  {
    const { handlers } = makeSandbox({
      fetchBehavior: "network-dead",
      mirrorAlive: true,
      cacheHit: null,
    });
    const res = (await runNavigation(handlers, "/deep/link?x=1&y=2"))!;
    const body = await res.text();
    check(
      "2. путь+query переносятся на зеркало",
      body.includes(MIRROR + "/deep/link?x=1&y=2")
    );
  }

  // 3. Зеркало мертво (инета нет) → офлайн-кэш, НЕ редирект
  {
    const { handlers, cachedShell } = makeSandbox({
      fetchBehavior: "network-dead",
      mirrorAlive: false,
      cacheHit: new Response("<html>cached-old-shell</html>", { status: 200 }),
    });
    void cachedShell;
    const res = (await runNavigation(handlers, "/"))!;
    const body = await res.text();
    check(
      "3. оба мертвы → офлайн-кэш",
      body.includes("cached-old-shell") && !body.includes("location.replace")
    );
  }

  // 4. Оба мертвы и кэш пуст → Response.error (как раньше)
  {
    const { handlers } = makeSandbox({
      fetchBehavior: "network-dead",
      mirrorAlive: false,
      cacheHit: null,
    });
    const res = (await runNavigation(handlers, "/"))!;
    check("4. кэш пуст → error-response", res.status === 0);
  }

  // 5. HTTP 503 (окно пропагации деплоя) → старый кэш, БЕЗ редиректа
  {
    const { handlers } = makeSandbox({
      fetchBehavior: "network-503",
      mirrorAlive: true,
      cacheHit: new Response("<html>cached-old-shell</html>", { status: 200 }),
    });
    const res = (await runNavigation(handlers, "/"))!;
    const body = await res.text();
    check(
      "5. 503 при живом зеркале → кэш, не редирект",
      body.includes("cached-old-shell") && !body.includes("location.replace")
    );
  }

  // 6. Сеть ок → свежий ответ, никакого фейловера
  {
    const { handlers } = makeSandbox({
      fetchBehavior: "network-ok",
      mirrorAlive: true,
      cacheHit: new Response("<html>cached-old-shell</html>", { status: 200 }),
    });
    const res = (await runNavigation(handlers, "/"))!;
    const body = await res.text();
    check("6. живой origin → свежий HTML", body.includes("fresh-shell"));
  }

  // 7. На самом зеркале редиректа нет (защита от цикла)
  {
    const { handlers } = makeSandbox({
      origin: MIRROR,
      fetchBehavior: "network-dead",
      mirrorAlive: true, // даже «живой» зонд не должен вызывать редирект
      cacheHit: new Response("<html>mirror-cached</html>", { status: 200 }),
    });
    const res = (await runNavigation(handlers, "/", MIRROR))!;
    const body = await res.text();
    check(
      "7. origin == зеркало → офлайн-кэш без редиректа",
      body.includes("mirror-cached") && !body.includes("location.replace")
    );
  }

  // 8. mirrorUrlFor: путь и query
  {
    const { sandbox } = makeSandbox({
      fetchBehavior: "network-ok",
      mirrorAlive: true,
    });
    const fn = sandbox.mirrorUrlFor as
      | ((p: string, s: string) => string)
      | undefined;
    check("8. mirrorUrlFor экспонирован в песочнице", typeof fn === "function");
    if (fn) {
      check("8b. корень", fn("/", "") === MIRROR + "/");
      check(
        "8c. путь+query 1:1",
        fn("/abc/def", "?x=1") === MIRROR + "/abc/def?x=1"
      );
    }
  }

  // 9. probeAlive: зависший зонд → false по таймауту; ответивший → true
  {
    const { sandbox } = makeSandbox({
      fetchBehavior: "network-dead",
      mirrorAlive: true,
      mirrorHangs: true,
    });
    const probe = sandbox.probeAlive as
      | ((u: string, t: number) => Promise<boolean>)
      | undefined;
    check("9. probeAlive экспонирован", typeof probe === "function");
    if (probe) {
      const t0 = Date.now();
      const dead = await probe(MIRROR + "/version.json", 60);
      check(
        "9b. зависший хост → false по таймауту",
        dead === false && Date.now() - t0 >= 55
      );
      const { sandbox: sb2 } = makeSandbox({
        fetchBehavior: "network-ok",
        mirrorAlive: true,
      });
      const probe2 = sb2.probeAlive as (u: string, t: number) => Promise<boolean>;
      const alive = await probe2(MIRROR + "/version.json", 3000);
      check("9c. ответивший хост → true", alive === true);
    }
  }

  console.log(`\nИтог: ${ok} OK / ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Тест упал:", e);
  process.exit(1);
});
