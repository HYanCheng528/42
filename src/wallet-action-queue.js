import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ACTIVE_STATUSES = new Set(["queued", "processing"]);
const TERMINAL_STATUSES = new Set(["completed", "partial_failed", "failed", "cancelled"]);

export function createWalletActionTask(cfg, task) {
  const dir = ensureQueueDir(cfg);
  const idempotencyKey = task.idempotencyKey || walletActionIdempotencyKey(task);
  const existing = listWalletActionTasks(cfg).find((item) =>
    item.idempotencyKey === idempotencyKey && ACTIVE_STATUSES.has(item.status)
  );
  if (existing) return { task: existing, created: false };

  const now = new Date().toISOString();
  const record = {
    version: 1,
    id: `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`,
    idempotencyKey,
    type: task.type,
    priority: Number(task.priority ?? 50),
    wallet: String(task.wallet ?? ""),
    market: String(task.market ?? ""),
    title: String(task.title ?? ""),
    status: "queued",
    payload: task.payload ?? {},
    progress: task.progress ?? null,
    result: null,
    error: "",
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null
  };
  writeTaskFile(path.join(dir, `${record.id}.json`), record);
  return { task: record, created: true };
}

export function readWalletActionTask(cfg, id) {
  if (!/^[a-z0-9-]+$/i.test(String(id ?? ""))) return null;
  for (const file of taskFileCandidates(cfg, id)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      // Try the next task location.
    }
  }
  return null;
}

export function listWalletActionTasks(cfg) {
  const dir = ensureQueueDir(cfg);
  const rows = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const row = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      if (row?.id) rows.push(row);
    } catch {
      // Ignore incomplete or corrupt task files.
    }
  }
  return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function updateWalletActionTask(cfg, id, patch) {
  const current = readWalletActionTask(cfg, id);
  if (!current) return null;
  const now = new Date().toISOString();
  const next = {
    ...current,
    ...patch,
    updatedAt: now
  };
  if (patch.status === "processing" && !next.startedAt) next.startedAt = now;
  if (TERMINAL_STATUSES.has(patch.status)) next.finishedAt = now;
  const activeFile = path.join(queueDir(cfg), `${id}.json`);
  const targetFile = TERMINAL_STATUSES.has(next.status)
    ? path.join(historyDir(cfg), `${id}.json`)
    : activeFile;
  writeTaskFile(targetFile, next);
  if (targetFile !== activeFile) {
    try {
      fs.unlinkSync(activeFile);
    } catch {
      // The task may already be in history.
    }
  }
  return next;
}

export function claimNextWalletActionTask(cfg, wallet) {
  const walletKey = String(wallet ?? "").toLowerCase();
  const queued = listWalletActionTasks(cfg)
    .filter((task) => task.status === "queued" && String(task.wallet).toLowerCase() === walletKey)
    .sort((a, b) => Number(a.priority ?? 50) - Number(b.priority ?? 50) ||
      String(a.createdAt).localeCompare(String(b.createdAt)));
  if (!queued.length) return null;
  return updateWalletActionTask(cfg, queued[0].id, {
    status: "processing",
    error: ""
  });
}

export function activeManualSellMarkets(cfg, wallet) {
  const walletKey = String(wallet ?? "").toLowerCase();
  return new Set(listWalletActionTasks(cfg)
    .filter((task) =>
      task.type === "manual_sell" &&
      ACTIVE_STATUSES.has(task.status) &&
      String(task.wallet).toLowerCase() === walletKey
    )
    .map((task) => String(task.market).toLowerCase()));
}

export function recoverInterruptedWalletActionTasks(cfg, wallet) {
  const walletKey = String(wallet ?? "").toLowerCase();
  for (const task of listWalletActionTasks(cfg)) {
    if (task.status !== "processing" || String(task.wallet).toLowerCase() !== walletKey) continue;
    updateWalletActionTask(cfg, task.id, {
      status: "failed",
      error: "Watch restarted while this task was processing; verify chain state before retrying"
    });
  }
}

export function walletActionTaskStatus(task) {
  return {
    active: ACTIVE_STATUSES.has(task?.status),
    terminal: TERMINAL_STATUSES.has(task?.status)
  };
}

function walletActionIdempotencyKey(task) {
  const payload = task.payload ?? {};
  if (task.type === "manual_sell") {
    return [
      "manual_sell",
      String(task.wallet ?? "").toLowerCase(),
      String(task.market ?? "").toLowerCase(),
      payload.all ? "all" : String(payload.tokenId ?? "")
    ].join(":");
  }
  if (task.type === "operator_approve") {
    return ["operator_approve", String(task.wallet ?? "").toLowerCase(), String(task.market ?? "").toLowerCase()].join(":");
  }
  if (task.type === "router_approve") {
    return ["router_approve", String(task.wallet ?? "").toLowerCase()].join(":");
  }
  return [
    task.type,
    String(task.wallet ?? "").toLowerCase(),
    String(task.market ?? "").toLowerCase(),
    payload.all ? "all" : String(payload.tokenId ?? ""),
    String(payload.percent ?? 100)
  ].join(":");
}

function ensureQueueDir(cfg) {
  const dir = queueDir(cfg);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(historyDir(cfg), { recursive: true });
  return dir;
}

function queueDir(cfg) {
  return path.resolve(cfg.walletActionQueueDir || "data/wallet-actions");
}

function historyDir(cfg) {
  return path.join(queueDir(cfg), "history");
}

function taskFileCandidates(cfg, id) {
  return [
    path.join(queueDir(cfg), `${id}.json`),
    path.join(historyDir(cfg), `${id}.json`)
  ];
}

function writeTaskFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
