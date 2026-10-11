import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./auth.js";
import { LANES, PAGE_SIZE, STATUSES } from "./constants.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function openDatabase(dataDir) {
  const memory = dataDir === ":memory:";
  if (!memory) mkdirSync(dataDir, { recursive: true });
  const file = memory ? ":memory:" : path.join(dataDir, "quorum.db");
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: true });
  if (!memory) db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      must_change INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ideas (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL DEFAULT '',
      author_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      votes INTEGER NOT NULL DEFAULT 0,
      reply TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS votes (
      idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
      voter_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (idea_id, voter_key)
    );
    CREATE TABLE IF NOT EXISTS releases (
      id INTEGER PRIMARY KEY,
      version TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      published_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
    CREATE INDEX IF NOT EXISTS idx_ideas_created ON ideas(created_at DESC);
  `);
  return db;
}

export function ensureAdmin(db, password, { reset = false } = {}) {
  const weak = password === "changeme" || password.length < 10;
  const existing = db.prepare("SELECT id FROM admins WHERE id = 1").get();
  if (!existing) {
    db.prepare("INSERT INTO admins (id, password_hash, must_change) VALUES (1, ?, ?)").run(
      hashPassword(password),
      weak ? 1 : 0,
    );
    return;
  }
  if (reset) {
    db.prepare("UPDATE admins SET password_hash = ?, must_change = ? WHERE id = 1").run(
      hashPassword(password),
      weak ? 1 : 0,
    );
    console.log("Admin password was reset from ADMIN_PASSWORD.");
  }
}

export function getAdmin(db) {
  return db.prepare("SELECT id, password_hash, must_change FROM admins WHERE id = 1").get();
}

export function setAdminPassword(db, password) {
  db.prepare("UPDATE admins SET password_hash = ?, must_change = 0 WHERE id = 1").run(hashPassword(password));
}

function nowIso() {
  return new Date().toISOString();
}

export function ensureSettings(db, defaults) {
  const insert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(defaults)) {
    const row = db.prepare("SELECT key FROM settings WHERE key = ?").get(key);
    if (!row) insert.run(key, value);
  }
}

export function getSettings(db) {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

export function updateSettings(db, entries) {
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of Object.entries(entries)) stmt.run(key, value);
}

function likeTerm(value) {
  return `%${String(value).replaceAll("\\", "").replaceAll("%", "").replaceAll("_", "")}%`;
}

export function queryIdeas(db, { status = "", q = "", includePending = false, sort = "top", page = 1, pageSize = PAGE_SIZE } = {}) {
  const where = [];
  const params = [];
  if (!includePending) where.push("status != 'pending'");
  if (status && STATUSES[status] && (includePending || status !== "pending")) {
    where.push("status = ?");
    params.push(status);
  }
  const term = q.trim();
  if (term) {
    where.push("(title LIKE ? OR body LIKE ?)");
    const like = likeTerm(term);
    params.push(like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order = sort === "new" ? "created_at DESC, id DESC" : "votes DESC, created_at DESC, id DESC";
  const total = db.prepare(`SELECT COUNT(*) AS n FROM ideas ${whereSql}`).get(...params).n;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  const offset = (safePage - 1) * pageSize;
  const rows = db.prepare(`SELECT * FROM ideas ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(
    ...params,
    pageSize,
    offset,
  );
  return { rows, total, page: safePage, pages };
}

export function publicStats(db) {
  return db
    .prepare("SELECT COUNT(*) AS ideas, COALESCE(SUM(votes), 0) AS votes FROM ideas WHERE status != 'pending'")
    .get();
}

export function getIdea(db, id) {
  return db.prepare("SELECT * FROM ideas WHERE id = ?").get(id);
}

export function recentDuplicate(db, authorKey, title) {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  return db
    .prepare(
      "SELECT id FROM ideas WHERE author_key = ? AND lower(title) = lower(?) AND created_at > ? LIMIT 1",
    )
    .get(authorKey, title, since);
}

export function createIdea(db, idea) {
  const timestamp = nowIso();
  const status = idea.status || "open";
  db.exec("BEGIN IMMEDIATE");
  try {
    const inserted = db
      .prepare(
        `INSERT INTO ideas (
          title, body, author_name, author_email, author_key, status, votes, reply, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, '', ?, ?)`,
      )
      .run(
        idea.title,
        idea.body,
        idea.authorName,
        idea.authorEmail,
        idea.authorKey,
        status,
        timestamp,
        timestamp,
      );
    const id = Number(inserted.lastInsertRowid);
    db.prepare("INSERT INTO votes (idea_id, voter_key, created_at) VALUES (?, ?, ?)").run(
      id,
      idea.authorKey,
      timestamp,
    );
    db.exec("COMMIT");
    return id;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function updateIdea(db, id, fields) {
  db.prepare(
    `UPDATE ideas
     SET title = ?, body = ?, author_name = ?, status = ?, reply = ?, updated_at = ?
     WHERE id = ?`,
  ).run(fields.title, fields.body, fields.authorName, fields.status, fields.reply, nowIso(), id);
}

export function deleteIdea(db, id) {
  db.prepare("DELETE FROM ideas WHERE id = ?").run(id);
}

export function toggleVote(db, ideaId, voterKey) {
  const existing = db.prepare("SELECT 1 AS ok FROM votes WHERE idea_id = ? AND voter_key = ?").get(ideaId, voterKey);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (existing) {
      db.prepare("DELETE FROM votes WHERE idea_id = ? AND voter_key = ?").run(ideaId, voterKey);
      db.prepare("UPDATE ideas SET votes = MAX(votes - 1, 0) WHERE id = ?").run(ideaId);
    } else {
      db.prepare("INSERT INTO votes (idea_id, voter_key, created_at) VALUES (?, ?, ?)").run(
        ideaId,
        voterKey,
        nowIso(),
      );
      db.prepare("UPDATE ideas SET votes = votes + 1 WHERE id = ?").run(ideaId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const row = db.prepare("SELECT votes FROM ideas WHERE id = ?").get(ideaId);
  return { voted: !existing, votes: row ? row.votes : 0 };
}

export function votedSet(db, voterKey) {
  if (!voterKey) return new Set();
  const rows = db.prepare("SELECT idea_id FROM votes WHERE voter_key = ?").all(voterKey);
  return new Set(rows.map((row) => row.idea_id));
}

export function laneIdeas(db, status) {
  return db
    .prepare(
      "SELECT * FROM ideas WHERE status = ? ORDER BY votes DESC, updated_at DESC LIMIT 30",
    )
    .all(status);
}

export function roadmap(db) {
  const lanes = {};
  for (const status of LANES) lanes[status] = laneIdeas(db, status);
  return lanes;
}

export function listReleases(db) {
  return db.prepare("SELECT * FROM releases ORDER BY published_at DESC, id DESC").all();
}

export function createRelease(db, release) {
  const inserted = db
    .prepare("INSERT INTO releases (version, title, body, published_at) VALUES (?, ?, ?, ?)")
    .run(release.version, release.title, release.body, nowIso());
  return Number(inserted.lastInsertRowid);
}

export function deleteRelease(db, id) {
  db.prepare("DELETE FROM releases WHERE id = ?").run(id);
}

export function allPublicIdeas(db) {
  return db
    .prepare("SELECT id, updated_at FROM ideas WHERE status != 'pending' ORDER BY id ASC")
    .all();
}

export function allIdeasForExport(db) {
  return db.prepare("SELECT * FROM ideas ORDER BY created_at DESC").all();
}

export function countPending(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM ideas WHERE status = 'pending'").get().n;
}
