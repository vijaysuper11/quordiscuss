import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../src/auth.js";
import {
  createIdea,
  deleteIdea,
  ensureAdmin,
  getAdmin,
  openDatabase,
  queryIdeas,
  toggleVote,
} from "../src/db.js";
import { csvCell, formatText, safeNext, safeUrl, validEmail } from "../src/text.js";

test("escapes changelog text and keeps simple formatting", () => {
  const html = formatText("Hello <script>\n\n- **One** item");
  assert.equal(html.includes("<script>"), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<strong>One<\/strong>/);
  assert.match(html, /<li>/);
});

test("rejects off-site redirects and unsafe footer links", () => {
  assert.equal(safeNext("https://evil.example", "/"), "/");
  assert.equal(safeNext("//evil.example", "/"), "/");
  assert.equal(safeNext("/ideas/4?sort=new", "/"), "/ideas/4?sort=new");
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("https://github.com/you/quorum"), "https://github.com/you/quorum");
});

test("neutralizes spreadsheet formulas in exports", () => {
  assert.equal(csvCell("=cmd()"), "'=cmd()");
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
});

test("votes toggle once per browser and pending ideas stay off the public board", () => {
  const db = openDatabase(":memory:");
  const id = createIdea(db, {
    title: "Dark mode",
    body: "A theme switch",
    authorName: "Maya",
    authorEmail: "",
    authorKey: "voter-a",
    status: "pending",
  });
  assert.equal(queryIdeas(db, {}).total, 0);
  assert.equal(queryIdeas(db, { includePending: true }).total, 1);

  const removed = toggleVote(db, id, "voter-a");
  assert.equal(removed.voted, false);
  assert.equal(removed.votes, 0);
  const added = toggleVote(db, id, "voter-b");
  assert.equal(added.voted, true);
  assert.equal(added.votes, 1);

  deleteIdea(db, id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM votes").get().n, 0);
});

test("default admin password must be replaced", () => {
  const db = openDatabase(":memory:");
  ensureAdmin(db, "changeme");
  assert.equal(getAdmin(db).must_change, 1);
  assert.equal(verifyPassword("changeme", getAdmin(db).password_hash), true);
  assert.equal(verifyPassword("nope", getAdmin(db).password_hash), false);
  assert.equal(hashPassword("another-long-password").includes(":"), true);
});

test("an empty board lists nothing until someone posts", () => {
  const db = openDatabase(":memory:");
  assert.equal(queryIdeas(db).total, 0);
  const id = createIdea(db, {
    title: "Ship the digest",
    body: "",
    authorName: "Asha",
    authorEmail: "",
    authorKey: "voter-a",
    status: "open",
  });
  const board = queryIdeas(db);
  assert.equal(board.total, 1);
  assert.equal(board.rows[0].id, id);
  assert.equal(board.rows[0].votes, 1);
});

test("the board ranks a popular idea above a newer one", () => {
  const db = openDatabase(":memory:");
  const older = createIdea(db, {
    title: "Older idea",
    body: "",
    authorName: "Asha",
    authorEmail: "",
    authorKey: "voter-a",
    status: "open",
  });
  const newer = createIdea(db, {
    title: "Newer idea",
    body: "",
    authorName: "Jules",
    authorEmail: "",
    authorKey: "voter-b",
    status: "open",
  });
  toggleVote(db, older, "voter-c");
  assert.equal(queryIdeas(db, { sort: "top" }).rows[0].id, older);
  assert.equal(queryIdeas(db, { sort: "new" }).rows[0].id, newer);
});

test("a visitor cannot leave a broken email", () => {
  assert.equal(validEmail(""), true);
  assert.equal(validEmail("asha@example.com"), true);
  assert.equal(validEmail("not-an-email"), false);
});
