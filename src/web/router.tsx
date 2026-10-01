import { type AnchorHTMLAttributes, type MouseEvent, useEffect, useState } from "react";

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    addEventListener("popstate", update);
    return () => removeEventListener("popstate", update);
  }, []);
  return path;
}

export function navigate(to: string) {
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
  scrollTo(0, 0);
}

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    // Leave modified clicks (new tab, new window) to the browser.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}

// A file dropped on a tool's home label, waiting for that tool to pick it up.
let pendingFile: File | null = null;

export function handOff(file: File) {
  pendingFile = file;
}

export function takeHandedOffFile(): File | null {
  const file = pendingFile;
  pendingFile = null;
  return file;
}
