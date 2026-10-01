import { useEffect, useState } from "react";
import { manifests } from "../tools/manifests.ts";
import { toolScreens } from "../tools/registry.client.tsx";
import { connectPresence } from "./api.ts";
import { Alert, ArrowLeft, ArrowRight } from "./components/icons.tsx";
import { Home } from "./Home.tsx";
import { Link, usePath } from "./router.tsx";

export function App() {
  const path = usePath();
  const [online, setOnline] = useState(true);
  useEffect(() => connectPresence(setOnline), []);

  const toolId = /^\/t\/([^/]+)\/?$/.exec(path)?.[1];
  const manifest = toolId ? manifests.find((m) => m.id === toolId) : undefined;
  const Screen = manifest ? toolScreens[manifest.id] : undefined;

  useEffect(() => {
    document.title = manifest ? `${manifest.name} · tools` : "tools";
  }, [manifest]);

  return (
    <div className="mx-auto grid max-w-[88rem] gap-3 p-3 sm:p-5">
      <header className="label sm:grid-cols-[1fr_auto]">
        <div className="box flex items-center gap-4">
          <h1 className="code text-4xl">
            <Link to="/" className="rounded-sm">
              tools
            </Link>
          </h1>
          {manifest && (
            <p className="code flex items-center gap-2 text-4xl" aria-label={manifest.name}>
              <span className="text-blank">/</span>
              {manifest.from}
              <ArrowRight width={28} height={28} />
              {manifest.to}
            </p>
          )}
        </div>
        <div className="box hidden sm:block">
          <span className="legend">Running on this machine</span>
          <p className="value mt-1 text-sm">{location.host}</p>
        </div>
      </header>

      {!online && (
        <div className="label" role="alert">
          <p className="box box-inverse flex items-center gap-3 font-semibold">
            <Alert className="shrink-0 text-signal" />
            <span>
              The tools server has stopped. Run <code className="value">tools</code> in a terminal to start it again.
            </span>
          </p>
        </div>
      )}

      <main className="grid gap-3">
        {path === "/" ? (
          <Home />
        ) : (
          <>
            <Link to="/" className="btn justify-self-start">
              <ArrowLeft />
              All tools
            </Link>
            {manifest && Screen ? (
              <Screen manifest={manifest} />
            ) : (
              <div className="label">
                <div className="box py-10">
                  <h2 className="code text-5xl">{manifest ? "Not built yet" : "No such page"}</h2>
                  <p className="mt-3 text-lg">
                    {manifest
                      ? `${manifest.name} is planned but has not been built.`
                      : "Nothing lives at this address."}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
