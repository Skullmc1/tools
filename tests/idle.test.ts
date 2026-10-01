import { expect, test } from "bun:test";
import { IdleWatcher } from "../src/server/idle.ts";

const IDLE = 30;
const idleCounter = () => {
  let fired = 0;
  const watcher = new IdleWatcher(IDLE, () => fired++);
  return { watcher, fired: () => fired };
};

test("fires when nothing ever holds it", async () => {
  const { fired } = idleCounter();
  await Bun.sleep(IDLE * 3);
  expect(fired()).toBe(1);
});

test("does not fire while held, then fires after the last release", async () => {
  const { watcher, fired } = idleCounter();
  const a = watcher.hold();
  const b = watcher.hold();
  await Bun.sleep(IDLE * 3);
  expect(fired()).toBe(0);

  a();
  a(); // releasing twice must not count twice
  await Bun.sleep(IDLE * 3);
  expect(fired()).toBe(0);

  b();
  await Bun.sleep(IDLE * 3);
  expect(fired()).toBe(1);
});

test("a new hold cancels a pending shutdown", async () => {
  const { watcher, fired } = idleCounter();
  await Bun.sleep(IDLE / 3);
  const release = watcher.hold();
  await Bun.sleep(IDLE * 3);
  expect(fired()).toBe(0);
  release();
  watcher.stop();
});
