import type { BunRequest, Server } from "bun";

export type Handler = (req: BunRequest<string>, server: Server<unknown>) => Response | Promise<Response>;
export type Routes = Record<string, Handler | Partial<Record<"GET" | "POST" | "DELETE", Handler>>>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Only the app's own pages may call the API. The Host check stops DNS
 * rebinding; the Origin check stops other websites posting to us.
 */
export function isAllowed(req: Request, port: number): boolean {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(req.headers.get("host") ?? "")) return false;
  const origin = req.headers.get("origin");
  return origin === null || hosts.some((host) => origin === `http://${host}`);
}

function guard(handler: Handler): Handler {
  return async (req, server) => {
    if (!isAllowed(req, server.port ?? 0)) return json({ error: "Forbidden" }, 403);
    try {
      return await handler(req, server);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(`${req.method} ${new URL(req.url).pathname}:`, error);
      return json({ error: error instanceof Error ? error.message : "Something went wrong" }, 500);
    }
  };
}

export function guardRoutes(routes: Routes): Routes {
  const guarded: Routes = {};
  for (const [path, entry] of Object.entries(routes)) {
    guarded[path] =
      typeof entry === "function"
        ? guard(entry)
        : Object.fromEntries(Object.entries(entry).map(([method, handler]) => [method, guard(handler)]));
  }
  return guarded;
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Expected a JSON body");
  }
}

/**
 * A server-sent event stream. `start` receives `send` and `close`, and may
 * return a cleanup function that runs once when the stream ends either way.
 */
export function sse(
  req: Request,
  start: (send: (data: unknown) => void, close: () => void) => (() => void) | void,
): Response {
  const encoder = new TextEncoder();
  let ended = false;
  let cleanup: (() => void) | void;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const end = () => {
    if (ended) return;
    ended = true;
    clearInterval(heartbeat);
    cleanup?.();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        if (ended) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          end();
        }
      };
      heartbeat = setInterval(() => write(": ping\n\n"), 15_000);
      req.signal.addEventListener("abort", end);
      const result = start(
        (data) => write(`data: ${JSON.stringify(data)}\n\n`),
        () => {
          end();
          try {
            controller.close();
          } catch {}
        },
      );
      if (ended) result?.();
      else cleanup = result;
    },
    cancel: end,
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}
