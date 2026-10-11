import { readFileSync } from "node:fs";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  clientIp,
  cookieHeader,
  loadSecret,
  parseCookies,
  randomId,
  rateLimit,
  readValue,
  signValue,
  tokensMatch,
  verifyPassword,
} from "./auth.js";
import { NOTICES, PAGE_SIZE, PRODUCT_NAME, STATUSES } from "./constants.js";
import {
  allIdeasForExport,
  allPublicIdeas,
  countPending,
  createIdea,
  createRelease,
  deleteIdea,
  deleteRelease,
  ensureAdmin,
  ensureSettings,
  getAdmin,
  getIdea,
  getSettings,
  listReleases,
  openDatabase,
  publicStats,
  queryIdeas,
  recentDuplicate,
  roadmap,
  setAdminPassword,
  toggleVote,
  updateIdea,
  updateSettings,
  votedSet,
} from "./db.js";
import { cleanBody, cleanText, csvCell, safeNext, safeUrl, validEmail } from "./text.js";
import {
  adminChangelogPage,
  adminHome,
  adminIdeaPage,
  boardPage,
  changelogPage,
  ideaPage,
  loginPage,
  messagePage,
  passwordGate,
  roadmapPage,
  rssXml,
  settingsPage,
  sitemapXml,
} from "./views.js";

const YEAR = 60 * 60 * 24 * 365;
const WEEK = 60 * 60 * 24 * 7;
const css = readFileSync(new URL("../public/app.css", import.meta.url));
const favicon = readFileSync(new URL("../public/favicon.svg", import.meta.url));

const dataDir = process.env.DATA_DIR || fileURLToPath(new URL("../data/", import.meta.url));
const adminPassword = process.env.ADMIN_PASSWORD || "";
if (!adminPassword) {
  console.error(`Set ADMIN_PASSWORD before starting ${PRODUCT_NAME}.`);
  process.exit(1);
}

const db = openDatabase(dataDir);
const secret = loadSecret(dataDir);
ensureAdmin(db, adminPassword, { reset: process.env.RESET_ADMIN_PASSWORD === "1" });
ensureSettings(db, {
  board_name: cleanText(process.env.BOARD_NAME || PRODUCT_NAME, 40) || PRODUCT_NAME,
  tagline: cleanText(process.env.BOARD_TAGLINE || "What should we build next?", 120),
  description: cleanText(
    process.env.BOARD_DESCRIPTION || "Suggest ideas, vote, and follow what ships.",
    300,
  ),
  project_url: safeUrl(process.env.PROJECT_URL || ""),
  moderation: "off",
});

const trustProxy = process.env.TRUST_PROXY === "1";
const port = Number(process.env.PORT || 8080);

function requestOrigin(req) {
  const configured = safeUrl(process.env.APP_URL || "");
  if (configured) return new URL(configured).origin;
  const forwarded = trustProxy ? req.headers["x-forwarded-proto"] : "";
  const proto = (typeof forwarded === "string" && forwarded.split(",")[0].trim()) || "http";
  const hostHeader = req.headers.host || `localhost:${port}`;
  const host = /^[a-zA-Z0-9.:-]+$/.test(hostHeader) ? hostHeader : `localhost:${port}`;
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

function secureRequest(req) {
  return requestOrigin(req).startsWith("https://");
}

async function readForm(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) {
      const error = new Error("too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function send(res, status, body, headers, cookies) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (cookies?.length) res.setHeader("Set-Cookie", cookies);
  res.writeHead(status, headers);
  res.end(body);
}

function htmlHeaders(nonce) {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": [
      "default-src 'self'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'self' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "connect-src 'none'",
    ].join("; "),
    "Cache-Control": "no-store",
  };
}

function redirect(res, location, cookies) {
  send(res, 303, "", { Location: location, "Cache-Control": "no-store" }, cookies);
}

function pageNumber(value) {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) return 1;
  return Math.min(page, 10000);
}

async function handle(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    send(res, 400, "Bad request", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  if (pathname.includes("..")) {
    send(res, 400, "Bad request", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  if (req.method === "GET" && pathname === "/health") {
    send(res, 200, JSON.stringify({ ok: true }), {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    return;
  }
  if (req.method === "GET" && pathname === "/assets/app.css") {
    send(res, 200, css, {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
    return;
  }
  if (req.method === "GET" && (pathname === "/favicon.svg" || pathname === "/favicon.ico")) {
    send(res, 200, favicon, {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    });
    return;
  }
  if (req.method === "GET" && pathname === "/robots.txt") {
    send(res, 200, "User-agent: *\nAllow: /\nDisallow: /admin\n", {
      "Content-Type": "text/plain; charset=utf-8",
    });
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const cookiesToSet = [];
  const secure = secureRequest(req);
  const voterToken = readValue(cookies.quorum_voter, secret);
  let voterKey = voterToken?.v && voterToken.exp > Date.now() ? voterToken.v : "";
  if (!voterKey) {
    voterKey = randomId();
    cookiesToSet.push(
      cookieHeader("quorum_voter", signValue({ v: voterKey, exp: Date.now() + YEAR * 1000 }, secret), {
        maxAge: YEAR,
        secure,
      }),
    );
  }
  let csrf = cookies.quorum_csrf || "";
  if (csrf.length < 20) {
    csrf = randomBytes(24).toString("base64url");
    cookiesToSet.push(cookieHeader("quorum_csrf", csrf, { maxAge: WEEK, secure, httpOnly: true }));
  }
  const session = readValue(cookies.quorum_session, secret);
  const admin = Boolean(session?.exp > Date.now() && session.role === "admin");
  const settings = getSettings(db);
  const ctx = {
    settings,
    csrf,
    admin,
    notice: NOTICES[url.searchParams.get("notice")] ? url.searchParams.get("notice") : "",
    nonce: randomBytes(16).toString("base64url"),
    origin: requestOrigin(req),
    path: pathname,
    pathWithQuery: `${pathname}${url.search}`,
    filters: {
      sort: url.searchParams.get("sort") === "new" ? "new" : "top",
      status: (() => {
        const value = url.searchParams.get("status") || "";
        if (!STATUSES[value] || value === "pending") return "";
        return value;
      })(),
      q: cleanText(url.searchParams.get("q") || "", 80),
    },
  };
  const ip = clientIp(req, trustProxy);
  const mustChange = admin && getAdmin(db)?.must_change === 1;

  const finishHtml = (status, html) => send(res, status, html, htmlHeaders(ctx.nonce), cookiesToSet);

  if (mustChange && pathname.startsWith("/admin") && pathname !== "/admin/password" && pathname !== "/admin/logout") {
    if (req.method === "GET") {
      finishHtml(200, passwordGate(ctx));
      return;
    }
  }

  if (req.method === "GET" && pathname === "/") {
    const result = queryIdeas(db, { ...ctx.filters, page: pageNumber(url.searchParams.get("page")), pageSize: PAGE_SIZE });
    finishHtml(200, boardPage(ctx, { result, voted: votedSet(db, voterKey), stats: publicStats(db) }));
    return;
  }

  if (req.method === "POST" && (pathname === "/" || pathname === "/ideas")) {
    const form = await readForm(req);
    const values = Object.fromEntries(form.entries());
    if (!tokensMatch(csrf, values.csrf)) {
      finishHtml(403, messagePage(ctx, { statusTitle: "Could not post", text: "Reload the page and try again.", code: 403 }).html);
      return;
    }
    if (values.website) {
      redirect(res, "/?notice=posted", cookiesToSet);
      return;
    }
    if (!rateLimit(`post:${ip}`, 6, 60 * 60 * 1000)) {
      finishHtml(429, messagePage(ctx, { statusTitle: "Slow down", text: "Too many ideas from this network. Try again later.", code: 429 }).html);
      return;
    }
    const title = cleanText(values.title, 140);
    const body = cleanBody(values.body, 2000);
    const authorName = cleanText(values.author_name, 40) || "Anonymous";
    const authorEmail = cleanText(values.author_email, 120);
    let error = "";
    if (title.length < 4) error = "Give the idea a title of at least 4 characters.";
    else if (!validEmail(authorEmail)) error = "That email does not look valid.";
    else if (recentDuplicate(db, voterKey, title)) error = "You already posted this idea recently.";
    if (error) {
      const result = queryIdeas(db, { ...ctx.filters, page: 1, pageSize: PAGE_SIZE });
      finishHtml(
        422,
        boardPage(ctx, {
          result,
          voted: votedSet(db, voterKey),
          stats: publicStats(db),
          error,
          form: { title, body, author_name: values.author_name || "", author_email: authorEmail },
        }),
      );
      return;
    }
    const status = settings.moderation === "on" ? "pending" : "open";
    const id = createIdea(db, { title, body, authorName, authorEmail, authorKey: voterKey, status });
    redirect(res, status === "pending" ? "/?notice=review" : `/ideas/${id}?notice=posted`, cookiesToSet);
    return;
  }

  const ideaMatch = pathname.match(/^\/ideas\/(\d+)$/);
  if (ideaMatch && req.method === "GET") {
    const idea = getIdea(db, Number(ideaMatch[1]));
    if (!idea || idea.status === "pending") {
      finishHtml(404, messagePage(ctx, { statusTitle: "Idea not found", text: "That idea is not on the board." }).html);
      return;
    }
    finishHtml(200, ideaPage(ctx, { idea, voted: votedSet(db, voterKey).has(idea.id) }));
    return;
  }

  const voteMatch = pathname.match(/^\/ideas\/(\d+)\/vote$/);
  if (voteMatch && req.method === "POST") {
    const form = await readForm(req);
    if (!tokensMatch(csrf, form.get("csrf"))) {
      redirect(res, "/", cookiesToSet);
      return;
    }
    if (!rateLimit(`vote:${ip}`, 60, 60 * 60 * 1000)) {
      finishHtml(429, messagePage(ctx, { statusTitle: "Slow down", text: "Too many votes from this network. Try again later.", code: 429 }).html);
      return;
    }
    const idea = getIdea(db, Number(voteMatch[1]));
    const next = safeNext(form.get("next"), idea ? `/ideas/${idea.id}` : "/");
    if (!idea || idea.status === "pending") {
      finishHtml(404, messagePage(ctx, { statusTitle: "Idea not found", text: "That idea is not on the board." }).html);
      return;
    }
    toggleVote(db, idea.id, voterKey);
    redirect(res, `${next}#idea-${idea.id}`, cookiesToSet);
    return;
  }

  if (req.method === "GET" && pathname === "/roadmap") {
    finishHtml(200, roadmapPage(ctx, roadmap(db)));
    return;
  }
  if (req.method === "GET" && pathname === "/changelog") {
    finishHtml(200, changelogPage(ctx, listReleases(db)));
    return;
  }
  if (req.method === "GET" && pathname === "/changelog.xml") {
    send(res, 200, rssXml(ctx, listReleases(db)), { "Content-Type": "application/rss+xml; charset=utf-8" }, cookiesToSet);
    return;
  }
  if (req.method === "GET" && pathname === "/sitemap.xml") {
    send(res, 200, sitemapXml(ctx.origin, allPublicIdeas(db)), {
      "Content-Type": "application/xml; charset=utf-8",
    });
    return;
  }

  if (pathname === "/admin/login") {
    if (req.method === "GET") {
      if (admin) {
        redirect(res, "/admin", cookiesToSet);
        return;
      }
      finishHtml(200, loginPage(ctx));
      return;
    }
    if (req.method === "POST") {
      const form = await readForm(req);
      if (!tokensMatch(csrf, form.get("csrf"))) {
        finishHtml(403, loginPage(ctx, { error: "Reload the page and try again." }));
        return;
      }
      if (!rateLimit(`login:${ip}`, 8, 15 * 60 * 1000)) {
        finishHtml(429, loginPage(ctx, { error: "Too many attempts. Wait a few minutes." }));
        return;
      }
      const record = getAdmin(db);
      if (!record || !verifyPassword(form.get("password") || "", record.password_hash)) {
        finishHtml(401, loginPage(ctx, { error: "Incorrect password." }));
        return;
      }
      cookiesToSet.push(
        cookieHeader("quorum_session", signValue({ role: "admin", exp: Date.now() + WEEK * 1000 }, secret), {
          maxAge: WEEK,
          secure,
        }),
      );
      redirect(res, "/admin", cookiesToSet);
      return;
    }
  }

  if (req.method === "POST" && pathname === "/admin/logout") {
    const form = await readForm(req);
    if (tokensMatch(csrf, form.get("csrf"))) {
      cookiesToSet.push(cookieHeader("quorum_session", "", { maxAge: 0, secure }));
    }
    redirect(res, "/", cookiesToSet);
    return;
  }

  if (pathname.startsWith("/admin")) {
    if (!admin) {
      redirect(res, "/admin/login", cookiesToSet);
      return;
    }
    if (req.method === "POST" && pathname === "/admin/password") {
      const form = await readForm(req);
      const current = form.get("current_password") || "";
      const next = form.get("new_password") || "";
      const record = getAdmin(db);
      let passwordError = "";
      if (!tokensMatch(csrf, form.get("csrf"))) passwordError = "Reload the page and try again.";
      else if (!record || !verifyPassword(current, record.password_hash)) passwordError = "Current password is incorrect.";
      else if (next.length < 10) passwordError = "Use at least 10 characters.";
      else if (next === "changeme") passwordError = "Choose a password other than the default.";
      if (passwordError) {
        const html = mustChange ? passwordGate(ctx, { error: passwordError }) : settingsPage(ctx, { passwordError });
        finishHtml(422, html);
        return;
      }
      setAdminPassword(db, next);
      redirect(res, "/admin?notice=password", cookiesToSet);
      return;
    }
    if (mustChange) {
      finishHtml(200, passwordGate(ctx));
      return;
    }
    if (req.method === "GET" && pathname === "/admin") {
      const result = queryIdeas(db, {
        includePending: true,
        sort: "new",
        page: pageNumber(url.searchParams.get("page")),
        pageSize: PAGE_SIZE,
      });
      finishHtml(200, adminHome(ctx, { result, pendingCount: countPending(db) }));
      return;
    }
    const adminIdea = pathname.match(/^\/admin\/ideas\/(\d+)$/);
    if (adminIdea && req.method === "GET") {
      const idea = getIdea(db, Number(adminIdea[1]));
      if (!idea) {
        finishHtml(404, messagePage(ctx, { statusTitle: "Idea not found", text: "That idea was already removed." }).html);
        return;
      }
      finishHtml(200, adminIdeaPage(ctx, { idea }));
      return;
    }
    if (adminIdea && req.method === "POST") {
      const idea = getIdea(db, Number(adminIdea[1]));
      const form = await readForm(req);
      if (!idea) {
        finishHtml(404, messagePage(ctx, { statusTitle: "Idea not found", text: "That idea was already removed." }).html);
        return;
      }
      const title = cleanText(form.get("title"), 140);
      const body = cleanBody(form.get("body"), 2000);
      const authorName = cleanText(form.get("author_name"), 40) || "Anonymous";
      const status = form.get("status") || "";
      const reply = cleanBody(form.get("reply"), 4000);
      let error = "";
      if (!tokensMatch(csrf, form.get("csrf"))) error = "Reload the page and try again.";
      else if (title.length < 4) error = "Title must be at least 4 characters.";
      else if (!STATUSES[status]) error = "Choose a valid status.";
      if (error) {
        finishHtml(422, adminIdeaPage(ctx, { idea: { ...idea, title, body, author_name: authorName, status, reply }, error }));
        return;
      }
      updateIdea(db, idea.id, { title, body, authorName, status, reply });
      redirect(res, `/admin/ideas/${idea.id}?notice=saved`, cookiesToSet);
      return;
    }
    const adminDelete = pathname.match(/^\/admin\/ideas\/(\d+)\/delete$/);
    if (adminDelete && req.method === "POST") {
      const form = await readForm(req);
      if (!tokensMatch(csrf, form.get("csrf"))) {
        redirect(res, "/admin", cookiesToSet);
        return;
      }
      deleteIdea(db, Number(adminDelete[1]));
      redirect(res, "/admin?notice=deleted", cookiesToSet);
      return;
    }
    if (pathname === "/admin/changelog" && req.method === "GET") {
      finishHtml(200, adminChangelogPage(ctx, { releases: listReleases(db) }));
      return;
    }
    if (pathname === "/admin/releases" && req.method === "POST") {
      const form = await readForm(req);
      const release = {
        version: cleanText(form.get("version"), 20),
        title: cleanText(form.get("title"), 120),
        body: cleanBody(form.get("body"), 8000),
      };
      let error = "";
      if (!tokensMatch(csrf, form.get("csrf"))) error = "Reload the page and try again.";
      else if (!release.version || !release.title || !release.body) error = "Version, title, and notes are required.";
      if (error) {
        finishHtml(422, adminChangelogPage(ctx, { releases: listReleases(db), error, form: release }));
        return;
      }
      createRelease(db, release);
      redirect(res, "/admin/changelog?notice=released", cookiesToSet);
      return;
    }
    const releaseDelete = pathname.match(/^\/admin\/releases\/(\d+)\/delete$/);
    if (releaseDelete && req.method === "POST") {
      const form = await readForm(req);
      if (tokensMatch(csrf, form.get("csrf"))) deleteRelease(db, Number(releaseDelete[1]));
      redirect(res, "/admin/changelog?notice=deleted", cookiesToSet);
      return;
    }
    if (pathname === "/admin/settings" && req.method === "GET") {
      finishHtml(200, settingsPage(ctx));
      return;
    }
    if (pathname === "/admin/settings" && req.method === "POST") {
      const form = await readForm(req);
      const next = {
        board_name: cleanText(form.get("board_name"), 40),
        tagline: cleanText(form.get("tagline"), 120),
        description: cleanText(form.get("description"), 300),
        project_url: safeUrl(form.get("project_url") || ""),
        moderation: form.get("moderation") === "on" ? "on" : "off",
      };
      if (!tokensMatch(csrf, form.get("csrf"))) {
        finishHtml(422, settingsPage({ ...ctx, settings: { ...settings, ...next } }, { error: "Reload the page and try again." }));
        return;
      }
      if (next.board_name.length < 2 || next.tagline.length < 4) {
        finishHtml(422, settingsPage({ ...ctx, settings: { ...settings, ...next } }, { error: "Add a board name and a headline." }));
        return;
      }
      if ((form.get("project_url") || "").trim() && !next.project_url) {
        finishHtml(422, settingsPage({ ...ctx, settings: { ...settings, ...next, project_url: form.get("project_url") } }, { error: "Project URL must start with http:// or https://." }));
        return;
      }
      updateSettings(db, next);
      redirect(res, "/admin/settings?notice=saved", cookiesToSet);
      return;
    }
    if (pathname === "/admin/export.csv" && req.method === "GET") {
      const header = ["id", "title", "body", "author_name", "author_email", "status", "votes", "reply", "created_at"];
      const lines = [header.join(",")];
      for (const idea of allIdeasForExport(db)) {
        lines.push(header.map((key) => csvCell(idea[key])).join(","));
      }
      send(
        res,
        200,
        `\uFEFF${lines.join("\n")}\n`,
        {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"quordiscuss-ideas.csv\"",
          "Cache-Control": "no-store",
        },
        cookiesToSet,
      );
      return;
    }
  }

  finishHtml(404, messagePage(ctx, { statusTitle: "Page not found", text: "That page does not exist." }).html);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    const status = error.status || 500;
    console.error(error);
    if (res.headersSent) {
      res.end();
      return;
    }
    const message = status === 413 ? "That submission is too large." : "Something went wrong.";
    send(res, status, message, { "Content-Type": "text/plain; charset=utf-8" });
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`${PRODUCT_NAME} listening on ${port}`);
});
