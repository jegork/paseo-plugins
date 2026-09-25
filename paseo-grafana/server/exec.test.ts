import assert from "node:assert/strict";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executableNames, resolveBinary } from "./exec.ts";

test("adds PATHEXT extensions when resolving a Windows command", () => {
  assert.deepEqual(
    executableNames("gcx", "win32", ".COM;.EXE;.BAT;.CMD"),
    ["gcx", "gcx.COM", "gcx.EXE", "gcx.BAT", "gcx.CMD"],
  );
});

test("does not append PATHEXT extensions on Unix", () => {
  assert.deepEqual(executableNames("gcx", "linux", ".EXE"), ["gcx"]);
});

test("does not duplicate an existing Windows executable extension", () => {
  assert.deepEqual(
    executableNames("gcx.exe", "win32", ".COM;.EXE;.BAT;.CMD"),
    ["gcx.exe"],
  );
});

test("falls back to <homedir>/.local/bin when HOME is absent", () => {
  const dir = join(homedir(), ".local", "bin");
  mkdirSync(dir, { recursive: true });
  const name = `paseo-grafana-fallback-${process.pid}`;
  const file = join(dir, name);
  writeFileSync(file, "");
  if (process.platform !== "win32") chmodSync(file, 0o755);

  const savedPath = process.env.PATH;
  const savedHome = process.env.HOME;
  try {
    process.env.PATH = "";
    delete process.env.HOME;
    assert.equal(resolveBinary(name), file);
  } finally {
    rmSync(file, { force: true });
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  }
});
