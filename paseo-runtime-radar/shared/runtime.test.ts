import { describe, expect, test } from "vitest";
import {
  attribute,
  parseDockerPs,
  parseLsofCwds,
  parseLsofListeners,
  publishedPorts,
  refuseReason,
  withoutPublishedPorts,
} from "./runtime";

describe("parseLsofListeners", () => {
  test("reads pid, command and every listening socket", () => {
    const out = ["p123", "cnode", "n*:3000", "n127.0.0.1:3001", "p456", "cpostgres", "n127.0.0.1:5432", ""].join("\n");
    expect(parseLsofListeners(out)).toEqual([
      { port: 3000, address: "*", pid: 123, command: "node" },
      { port: 3001, address: "127.0.0.1", pid: 123, command: "node" },
      { port: 5432, address: "127.0.0.1", pid: 456, command: "postgres" },
    ]);
  });

  test("keeps ipv6 addresses intact and drops duplicate sockets", () => {
    const out = ["p9", "cnext-server", "n[::1]:3000", "n[::1]:3000", "n*:3000"].join("\n");
    expect(parseLsofListeners(out).map((l) => l.address)).toEqual(["[::1]", "*"]);
  });

  test("ignores a socket line before any process", () => {
    expect(parseLsofListeners("n*:80\n")).toEqual([]);
  });
});

describe("parseLsofCwds", () => {
  test("maps each pid to its working directory", () => {
    expect(parseLsofCwds("p1\nfcwd\nn/Users/me/app\np2\nfcwd\nn/tmp\n")).toEqual(
      new Map([
        [1, "/Users/me/app"],
        [2, "/tmp"],
      ]),
    );
  });
});

describe("parseDockerPs", () => {
  test("reads compose labels and splits ports", () => {
    const line = JSON.stringify({
      ID: "abc",
      Names: "api-db-1",
      Image: "postgres:17",
      Status: "Up 2 hours",
      Ports: "0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp",
      Labels: "com.docker.compose.project=api,com.docker.compose.project.working_dir=/Users/me/api,other=x",
    });
    expect(parseDockerPs(`${line}\n`)).toEqual([
      {
        id: "abc",
        name: "api-db-1",
        image: "postgres:17",
        status: "Up 2 hours",
        ports: ["0.0.0.0:5432->5432/tcp", "[::]:5432->5432/tcp"],
        project: "api",
        workingDir: "/Users/me/api",
      },
    ]);
  });

  test("tolerates a plain docker run container and junk lines", () => {
    const line = JSON.stringify({ ID: "1", Names: "mig-check", Image: "postgres", Status: "Up", Ports: "", Labels: "" });
    expect(parseDockerPs(`not json\n${line}`)).toMatchObject([{ name: "mig-check", ports: [], project: null, workingDir: null }]);
  });
});

describe("attribute", () => {
  const workspaces = [
    { id: "root", name: "app", directory: "/Users/me/app" },
    { id: "wt", name: "feature", directory: "/Users/me/app/.worktrees/feature/" },
    { id: "other", name: "other", directory: "/Users/me/other" },
  ];

  test("prefers the deepest containing workspace", () => {
    expect(attribute("/Users/me/app/.worktrees/feature/web", workspaces)).toBe("wt");
    expect(attribute("/Users/me/app/web", workspaces)).toBe("root");
  });

  test("does not match a sibling directory that shares a prefix", () => {
    expect(attribute("/Users/me/application", workspaces)).toBeNull();
  });

  test("matches the directory itself and handles a missing path", () => {
    expect(attribute("/Users/me/other", workspaces)).toBe("other");
    expect(attribute(null, workspaces)).toBeNull();
  });
});

describe("withoutPublishedPorts", () => {
  const containers = [
    { id: "1", name: "db", image: "postgres", status: "Up", ports: ["0.0.0.0:5434->5432/tcp", "[::]:5434->5432/tcp"], project: null, workingDir: null },
    { id: "2", name: "lk", image: "livekit", status: "Up", ports: ["0.0.0.0:7880-7881->7880-7881/tcp", "0.0.0.0:7882->7882/udp"], project: null, workingDir: null },
    { id: "3", name: "worker", image: "w", status: "Up", ports: ["8000/tcp"], project: null, workingDir: null },
  ];

  test("collects host ports including ranges and skips unpublished ones", () => {
    expect([...publishedPorts(containers)].sort((a, b) => a - b)).toEqual([5434, 7880, 7881, 7882]);
  });

  test("drops the proxy listeners for published ports and keeps the rest", () => {
    const sockets = [
      { port: 5434, address: "*", pid: 1, command: "OrbStack Helper" },
      { port: 5432, address: "*", pid: 1, command: "OrbStack Helper" },
      { port: 7881, address: "*", pid: 1, command: "OrbStack Helper" },
      { port: 5173, address: "*", pid: 2, command: "node" },
    ];
    expect(withoutPublishedPorts(sockets, containers).map((s) => s.port)).toEqual([5432, 5173]);
  });
});

describe("refuseReason", () => {
  const self = { pid: 500, ppid: 400 };

  test("refuses pid 1, the plugin process and its daemon parent before any lookup", () => {
    for (const pid of [0, 1, 500, 400]) expect(refuseReason(pid, [], self)).toBe("That process is Paseo itself.");
  });

  test("refuses a pid that no longer listens, even if other processes do", () => {
    // the bug this guards: an lsof answer that describes other processes
    const others = [{ port: 6767, address: "*", pid: 23686, command: "Paseo\\x20Helper" }];
    expect(refuseReason(71170, others, self)).toBe("pid 71170 is not listening on any port any more.");
  });

  test("refuses any Paseo process by name", () => {
    const sockets = [{ port: 6767, address: "*", pid: 23686, command: "Paseo\\x20Helper" }];
    expect(refuseReason(23686, sockets, self)).toBe("That process is Paseo itself.");
  });

  test("allows a listening dev server", () => {
    const sockets = [{ port: 5173, address: "*", pid: 71170, command: "node" }];
    expect(refuseReason(71170, sockets, self)).toBeNull();
  });
});
