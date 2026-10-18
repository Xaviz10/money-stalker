import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createAPI } from "./api";
import { MemoryRepository } from "./repository";
import { MemoryFiles } from "./storage";
import { processJob } from "./processing";
import { MAX_FILE_BYTES } from "./imports";

const repo = new MemoryRepository(),
  files = new MemoryFiles();
const ephemeral = process.env.LOCAL_EPHEMERAL === "1";
const port = Number(process.env.LOCAL_API_PORT ?? "8787");
const allowedPorts = new Set(
  ["5173", "4173", String(port), process.env.LOCAL_WEB_PORT].filter(
    (value): value is string => Boolean(value),
  ),
);
const stateFile = ".local/state.json";
if (!ephemeral) {
  try {
    const saved = JSON.parse(await readFile(stateFile, "utf8"));
    for (const key of ["states", "jobs", "deviceRows", "batchRows"] as const)
      repo[key] = new Map(saved[key] ?? []) as never;
    files.values = new Map(
      (saved.files ?? []).map(([key, value]: [string, string]) => [
        key,
        Buffer.from(value, "base64"),
      ]),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
let persistence = Promise.resolve();
async function persist() {
  if (ephemeral) return;
  const data = JSON.stringify({
    states: [...repo.states],
    jobs: [...repo.jobs],
    deviceRows: [...repo.deviceRows],
    batchRows: [...repo.batchRows],
    files: [...files.values].map(([k, v]) => [
      k,
      Buffer.from(v).toString("base64"),
    ]),
  });
  persistence = persistence.then(async () => {
    await mkdir(".local", { recursive: true, mode: 0o700 });
    await writeFile(`${stateFile}.tmp`, data, { mode: 0o600 });
    await rename(`${stateFile}.tmp`, stateFile);
  });
  await persistence;
}
const api = createAPI(repo, files);
let working = false;
async function drain() {
  if (working) return;
  working = true;
  try {
    for (const j of await repo.pendingJobs()) {
      try {
        await processJob(repo, files, j.householdId, j.id);
      } catch {
        /* error recorded on the job */
      }
    }
    await persist();
  } finally {
    working = false;
  }
}
setInterval(() => void drain(), 1000).unref();
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const origin = req.headers.origin;
    if (origin) {
      const value = new URL(origin);
      if (
        value.protocol !== "http:" ||
        !["localhost", "127.0.0.1"].includes(value.hostname) ||
        !allowedPorts.has(value.port)
      ) {
        res.writeHead(403);
        res.end("Origen no permitido");
        return;
      }
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const path = url.pathname.replace(/^\/api/, "");
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_FILE_BYTES + 1000) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (path === "/local-upload" && req.method === "PUT") {
      const key = url.searchParams.get("key") ?? "";
      if (!key.startsWith("original/local-owner/")) {
        res.writeHead(403);
        res.end();
        return;
      }
      await files.put(key, bytes);
      await persist();
      res.writeHead(204);
      res.end();
      return;
    }
    if (ephemeral && path === "/test/reset" && req.method === "POST") {
      repo.states.clear();
      repo.jobs.clear();
      repo.deviceRows.clear();
      repo.batchRows.clear();
      files.values.clear();
      res.writeHead(204);
      res.end();
      return;
    }
    const result = await api({
      method: req.method ?? "GET",
      path,
      query: Object.fromEntries(url.searchParams),
      subject: path === "/capture-events" ? undefined : "local-owner",
      token: req.headers.authorization?.replace(/^Bearer /i, ""),
      body: bytes.length ? JSON.parse(bytes.toString()) : undefined,
    });
    await persist();
    res.writeHead(result.status, {
      "Content-Type": result.type ?? "application/json",
      ...(result.filename
        ? { "Content-Disposition": `attachment; filename="${result.filename}"` }
        : {}),
    });
    res.end(
      Buffer.isBuffer(result.body) ? result.body : JSON.stringify(result.body),
    );
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Solicitud inválida" }));
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Local API http://127.0.0.1:${port}/api — development identity only; never expose this server.`,
  ),
);
