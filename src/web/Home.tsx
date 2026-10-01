import type { ToolManifest } from "../tools/manifests.ts";
import { manifests } from "../tools/manifests.ts";
import { hasAcceptedExtension, useFileDrop } from "./components/DropZone.tsx";
import { ArrowRight } from "./components/icons.tsx";
import { handOff, Link, navigate } from "./router.tsx";

/** The sheet of labels: live tools printed, planned ones still blank. */
export function Home() {
  const live = manifests.filter((m) => m.status === "live");
  const planned = manifests.filter((m) => m.status === "planned");
  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <div className="grid gap-3 lg:col-span-7">
        {live.map((manifest) => (
          <LiveLabel key={manifest.id} manifest={manifest} />
        ))}
      </div>
      <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:col-span-5">
        {planned.map((manifest) => (
          <PlannedLabel key={manifest.id} manifest={manifest} />
        ))}
      </div>
    </div>
  );
}

function LiveLabel({ manifest }: { manifest: ToolManifest }) {
  const to = `/t/${manifest.id}`;
  // Dropping a file on the label opens the tool with it already loaded.
  const { over, handlers } = useFileDrop((file) => {
    if (hasAcceptedExtension(file, manifest.accepts)) handOff(file);
    navigate(to);
  });

  return (
    <article className="group label relative grid-cols-2" {...handlers}>
      <div className="box pb-6">
        <span className="legend">From</span>
        <p className="code mt-6 text-7xl sm:text-9xl xl:text-[11rem]">{manifest.from}</p>
      </div>
      <div className="box box-inverse pb-6">
        <span className="legend">To</span>
        <p className="code mt-6 text-7xl sm:text-9xl xl:text-[11rem]">{manifest.to}</p>
      </div>
      <div className="box col-span-2 py-6">
        <h2 className="code text-5xl">{manifest.name}</h2>
        <p className="mt-3 text-lg">{manifest.tagline}</p>
      </div>
      <div className="box">
        <span className="legend">Accepts</span>
        <p className="value mt-1 text-sm">{manifest.accepts.join("  ")}</p>
      </div>
      <Link
        to={to}
        className={`code flex min-h-20 items-center justify-between gap-3 px-4 text-4xl transition-colors duration-150 after:absolute after:inset-0 focus-visible:outline-ink group-hover:bg-ink group-hover:text-stock ${
          over ? "bg-ink text-stock" : "bg-signal"
        }`}
      >
        {over ? "Drop" : "Open"}
        <ArrowRight width={36} height={36} />
      </Link>
    </article>
  );
}

function PlannedLabel({ manifest }: { manifest: ToolManifest }) {
  return (
    <article className="label grid-rows-[auto_1fr] border-blank bg-blank">
      <div className="box flex items-center gap-2 text-ink-soft">
        <p className="code text-4xl">{manifest.from}</p>
        <ArrowRight className="shrink-0" />
        <p className="code text-4xl">{manifest.to}</p>
      </div>
      <div className="box">
        <h2 className="font-bold">{manifest.name}</h2>
        <p className="mt-1 text-sm text-ink-soft">{manifest.tagline}</p>
        <p className="stamp mt-4 text-sm">Planned</p>
      </div>
    </article>
  );
}
