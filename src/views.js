import { LANES, NOTICES, PRODUCT_NAME, STATUSES } from "./constants.js";
import { boardHref, escapeHtml, excerpt, formatDate, formatText, jsonLdScript, relativeTime, safeUrl } from "./text.js";

const PUBLIC_FILTERS = [
  ["", "All"],
  ["open", "Open"],
  ["planned", "Planned"],
  ["building", "Building"],
  ["done", "Shipped"],
  ["declined", "Not now"],
];

function csrfField(csrf) {
  return `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">`;
}

function statusPill(status) {
  const meta = STATUSES[status] || STATUSES.open;
  return `<span class="pill" data-status="${escapeHtml(status)}">${escapeHtml(meta.label)}</span>`;
}

function countPhrase(count, singular, plural) {
  return `${count} ${Number(count) === 1 ? singular : plural}`;
}

function brandMark() {
  return `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8"></rect><path d="M8.5 20.5 16 9l7.5 11.5"></path><path d="M11.5 20.5h9"></path></svg>`;
}

export function layout({
  title,
  description,
  settings,
  path,
  body,
  csrf,
  admin = false,
  notice = "",
  robots = "index,follow",
  jsonLd = null,
  nonce,
  origin,
  extraHead = "",
}) {
  const boardName = settings.board_name || PRODUCT_NAME;
  const pageTitle = title ? `${title} · ${boardName}` : boardName;
  const desc = excerpt(description || settings.description || "", 160);
  const canonical = origin ? `${origin}${path.split("?")[0]}` : "";
  const projectUrl = safeUrl(settings.project_url);
  const noticeText = NOTICES[notice] || "";
  const current = path.split("?")[0];
  const nav = [
    ["/", "Board"],
    ["/roadmap", "Roadmap"],
    ["/changelog", "Changelog"],
  ]
    .map(([href, label]) => {
      const here = current === href ? ` aria-current="page"` : "";
      return `<a href="${href}"${here}>${label}</a>`;
    })
    .join("");
  const adminLink = admin
    ? `<a href="/admin"${current.startsWith("/admin") ? ` aria-current="page"` : ""}>Admin</a>
       <form method="post" action="/admin/logout">${csrfField(csrf)}<button class="text-button" type="submit">Log out</button></form>`
    : `<a href="/admin/login">Admin</a>`;
  const structured = jsonLd
    ? `<script type="application/ld+json" nonce="${escapeHtml(nonce)}">${jsonLdScript(jsonLd)}</script>`
    : "";
  const footerLink = projectUrl
    ? `<a href="${escapeHtml(projectUrl)}">${PRODUCT_NAME}</a>`
    : PRODUCT_NAME;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(desc)}">
  <meta name="robots" content="${escapeHtml(robots)}">
  <meta name="theme-color" content="#f4f6f9">
  ${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ""}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/app.css?v=6">
  ${extraHead}
  ${structured}
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <div class="sheet">
    <header class="site-header">
      <a class="brand" href="/">${brandMark()}<span>${escapeHtml(boardName)}</span></a>
      <nav class="nav" aria-label="Primary">${nav}${adminLink}</nav>
    </header>
    <main id="main">
      ${noticeText ? `<p class="notice" role="status">${escapeHtml(noticeText)}</p>` : ""}
      ${body}
    </main>
    <footer class="site-footer">
      <p>Powered by ${footerLink}, an open-source feedback board.</p>
    </footer>
  </div>
</body>
</html>`;
}

function ideaCard(idea, { voted, csrf, next }) {
  const label = voted
    ? `Remove your vote. ${countPhrase(idea.votes, "vote", "votes")}.`
    : `Upvote. ${countPhrase(idea.votes, "vote", "votes")}.`;
  return `<article class="idea" id="idea-${idea.id}">
    <form method="post" action="/ideas/${idea.id}/vote">
      ${csrfField(csrf)}
      <input type="hidden" name="next" value="${escapeHtml(next)}">
      <button class="vote${voted ? " is-voted" : ""}" type="submit" aria-pressed="${voted ? "true" : "false"}" aria-label="${escapeHtml(label)}">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 10.5 8 4l5 6.5"></path></svg>
        <span class="vote-count">${idea.votes}</span>
      </button>
    </form>
    <div class="idea-body">
      <div class="idea-top">
        <h2><a href="/ideas/${idea.id}">${escapeHtml(idea.title)}</a></h2>
        ${statusPill(idea.status)}
      </div>
      ${idea.body ? `<p class="excerpt">${escapeHtml(excerpt(idea.body, 180))}</p>` : ""}
      <p class="meta">${escapeHtml(idea.author_name)} · ${escapeHtml(relativeTime(idea.created_at))}</p>
    </div>
  </article>`;
}

export function boardPage(ctx, { result, voted, form = {}, error = "", stats }) {
  const { sort, status, q } = ctx.filters;
  const sorts = [
    ["top", "Top"],
    ["new", "New"],
  ]
    .map(([key, label]) => {
      const href = boardHref({ sort: key, status, q });
      return `<a href="${href}"${sort === key ? ` aria-current="page"` : ""}>${label}</a>`;
    })
    .join("");
  const filters = PUBLIC_FILTERS.map(([key, label]) => {
    const href = boardHref({ sort, status: key, q });
    const current = status === key ? ` aria-current="page"` : "";
    return `<a href="${href}"${current}>${label}</a>`;
  }).join("");
  const next = boardHref({ sort, status, q, page: result.page });
  const cards = result.rows.length
    ? result.rows.map((idea) => ideaCard(idea, { voted: voted.has(idea.id), csrf: ctx.csrf, next })).join("")
    : `<div class="empty"><h2>No ideas ${q || status ? "match" : "yet"}</h2><p>${q || status ? "Try another filter." : "Post the first suggestion. One vote is already counted for you."}</p></div>`;
  const pages = pagination(result, (page) => boardHref({ sort, status, q, page }));
  const body = `<section class="composer">
      <div>
        <p class="eyebrow">Feedback board</p>
        <h1>${escapeHtml(ctx.settings.tagline || "What should we build next?")}</h1>
        <p class="lede">${escapeHtml(ctx.settings.description || "")}</p>
        <p class="stats"><strong>${stats.ideas}</strong> ${Number(stats.ideas) === 1 ? "idea" : "ideas"} · <strong>${stats.votes}</strong> ${Number(stats.votes) === 1 ? "vote" : "votes"}</p>
      </div>
      <form method="post" action="/" class="stack">
        ${csrfField(ctx.csrf)}
        ${error ? `<p class="form-error" role="alert">${escapeHtml(error)}</p>` : ""}
        <label for="title">Idea</label>
        <input id="title" name="title" required minlength="4" maxlength="140" value="${escapeHtml(form.title || "")}" placeholder="A short title people can vote on">
        <label for="body">Details <span class="optional">optional</span></label>
        <textarea id="body" name="body" maxlength="2000" rows="4" placeholder="What would this change, and who is it for?">${escapeHtml(form.body || "")}</textarea>
        <div class="split">
          <div>
            <label for="author_name">Name <span class="optional">optional</span></label>
            <input id="author_name" name="author_name" maxlength="40" value="${escapeHtml(form.author_name || "")}" autocomplete="nickname">
          </div>
          <div>
            <label for="author_email">Email <span class="optional">optional, private</span></label>
            <input id="author_email" name="author_email" type="email" maxlength="120" value="${escapeHtml(form.author_email || "")}" autocomplete="email">
          </div>
        </div>
        <p class="hint">Your email is visible only to the people running this board. One vote per browser.</p>
        <div class="hp" aria-hidden="true">
          <label for="website">Website</label>
          <input id="website" name="website" tabindex="-1" autocomplete="off">
        </div>
        <button class="primary" type="submit">Post idea</button>
      </form>
    </section>
    <div class="toolbar">
      <div class="chips" aria-label="Sort">${sorts}</div>
      <div class="chips" aria-label="Status">${filters}</div>
      <form class="search" method="get" action="/">
        ${sort !== "top" ? `<input type="hidden" name="sort" value="${escapeHtml(sort)}">` : ""}
        ${status ? `<input type="hidden" name="status" value="${escapeHtml(status)}">` : ""}
        <label class="sr" for="q">Search ideas</label>
        <input id="q" type="search" name="q" value="${escapeHtml(q)}" placeholder="Search ideas" maxlength="80">
        <button type="submit">Search</button>
      </form>
    </div>
    <section class="list" aria-label="Ideas">${cards}</section>
    ${pages}`;
  return layout({
    title: "",
    description: ctx.settings.description,
    settings: ctx.settings,
    path: ctx.pathWithQuery,
    body,
    csrf: ctx.csrf,
    admin: ctx.admin,
    notice: ctx.notice,
    nonce: ctx.nonce,
    origin: ctx.origin,
    jsonLd: websiteJsonLd(ctx),
  });
}

function pagination(result, hrefFor) {
  if (result.pages <= 1) return "";
  const prev = result.page > 1 ? `<a href="${hrefFor(result.page - 1)}">Previous</a>` : "<span>Previous</span>";
  const next = result.page < result.pages ? `<a href="${hrefFor(result.page + 1)}">Next</a>` : "<span>Next</span>";
  return `<nav class="pager" aria-label="Pagination">${prev}<span>Page ${result.page} of ${result.pages}</span>${next}</nav>`;
}

export function ideaPage(ctx, { idea, voted }) {
  const next = `/ideas/${idea.id}`;
  const body = `<article class="detail" id="idea-${idea.id}">
      <p class="eyebrow"><a href="/">Board</a></p>
      <div class="idea">
        <form method="post" action="/ideas/${idea.id}/vote">
          ${csrfField(ctx.csrf)}
          <input type="hidden" name="next" value="${next}">
          <button class="vote vote-large${voted ? " is-voted" : ""}" type="submit" aria-pressed="${voted ? "true" : "false"}">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 10.5 8 4l5 6.5"></path></svg>
            <span class="vote-count">${idea.votes}</span>
            <span class="vote-label">${voted ? "Voted" : "Upvote"}</span>
          </button>
        </form>
        <div class="idea-body">
          <div class="idea-top detail-title">
            <h1>${escapeHtml(idea.title)}</h1>
            ${statusPill(idea.status)}
          </div>
          <p class="meta">${escapeHtml(idea.author_name)} · ${escapeHtml(formatDate(idea.created_at))}</p>
          <div class="prose">${formatText(idea.body) || "<p>No extra details.</p>"}</div>
          ${
            idea.reply
              ? `<section class="reply"><h2>Team response</h2><div class="prose">${formatText(idea.reply)}</div></section>`
              : ""
          }
        </div>
      </div>
    </article>`;
  return layout({
    title: idea.title,
    description: excerpt(idea.body || idea.title, 160),
    settings: ctx.settings,
    path: `/ideas/${idea.id}`,
    body,
    csrf: ctx.csrf,
    admin: ctx.admin,
    notice: ctx.notice,
    nonce: ctx.nonce,
    origin: ctx.origin,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Board", item: `${ctx.origin}/` },
        { "@type": "ListItem", position: 2, name: idea.title, item: `${ctx.origin}/ideas/${idea.id}` },
      ],
    },
  });
}

export function roadmapPage(ctx, lanes) {
  const columns = LANES.map((status) => {
    const items = lanes[status];
    const cards = items.length
      ? items
          .map(
            (idea) => `<a class="lane-card" href="/ideas/${idea.id}">
              <span class="vote-count">${idea.votes}</span>
              <span>
                <strong>${escapeHtml(idea.title)}</strong>
                <em>${escapeHtml(relativeTime(idea.updated_at))}</em>
              </span>
            </a>`,
          )
          .join("")
      : `<p class="lane-empty">Nothing here yet.</p>`;
    return `<section class="lane" aria-labelledby="lane-${status}">
      <h2 id="lane-${status}">${escapeHtml(STATUSES[status].lane)} <span>${items.length}</span></h2>
      ${cards}
    </section>`;
  }).join("");
  return layout({
    title: "Roadmap",
    description: `Public roadmap for ${ctx.settings.board_name}.`,
    settings: ctx.settings,
    path: "/roadmap",
    body: `<header class="page-head"><p class="eyebrow">Roadmap</p><h1>What is planned, in progress, and shipped</h1></header><div class="lanes">${columns}</div>`,
    csrf: ctx.csrf,
    admin: ctx.admin,
    notice: ctx.notice,
    nonce: ctx.nonce,
    origin: ctx.origin,
    jsonLd: websiteJsonLd(ctx),
  });
}

export function changelogPage(ctx, releases) {
  const items = releases.length
    ? releases
        .map(
          (release) => `<article class="release" id="release-${release.id}">
            <p class="version">${escapeHtml(release.version)}</p>
            <div>
              <h2>${escapeHtml(release.title)}</h2>
              <p class="meta"><time datetime="${escapeHtml(release.published_at)}">${escapeHtml(formatDate(release.published_at))}</time></p>
              <div class="prose">${formatText(release.body)}</div>
            </div>
          </article>`,
        )
        .join("")
    : `<div class="empty"><h2>No updates yet</h2><p>Shipped work will show up here.</p></div>`;
  return layout({
    title: "Changelog",
    description: `Product updates from ${ctx.settings.board_name}.`,
    settings: ctx.settings,
    path: "/changelog",
    body: `<header class="page-head"><p class="eyebrow">Changelog</p><h1>What shipped</h1></header><div class="releases">${items}</div>`,
    csrf: ctx.csrf,
    admin: ctx.admin,
    notice: ctx.notice,
    nonce: ctx.nonce,
    origin: ctx.origin,
    extraHead: `<link rel="alternate" type="application/rss+xml" title="Changelog" href="/changelog.xml">`,
    jsonLd: websiteJsonLd(ctx),
  });
}

export function loginPage(ctx, { error = "" } = {}) {
  const body = `<form method="post" action="/admin/login" class="panel narrow stack">
      <p class="eyebrow">Admin</p>
      <h1>Sign in</h1>
      ${error ? `<p class="form-error" role="alert">${escapeHtml(error)}</p>` : ""}
      ${csrfField(ctx.csrf)}
      <label for="password">Password</label>
      <input id="password" name="password" type="password" required autocomplete="current-password">
      <button class="primary" type="submit">Continue</button>
    </form>`;
  return layout({
    title: "Admin sign in",
    description: "Sign in to manage the board.",
    settings: ctx.settings,
    path: "/admin/login",
    body,
    csrf: ctx.csrf,
    admin: false,
    robots: "noindex,nofollow",
    nonce: ctx.nonce,
    origin: ctx.origin,
  });
}

export function passwordGate(ctx, { error = "" } = {}) {
  const body = `<form method="post" action="/admin/password" class="panel narrow stack">
      <p class="eyebrow">First visit</p>
      <h1>Choose an admin password</h1>
      <p class="lede">This board is still using the default password. Set a new one before managing ideas.</p>
      ${error ? `<p class="form-error" role="alert">${escapeHtml(error)}</p>` : ""}
      ${csrfField(ctx.csrf)}
      <label for="current_password">Current password</label>
      <input id="current_password" name="current_password" type="password" required autocomplete="current-password">
      <label for="new_password">New password</label>
      <input id="new_password" name="new_password" type="password" required minlength="10" autocomplete="new-password">
      <p class="hint">At least 10 characters.</p>
      <button class="primary" type="submit">Save password</button>
    </form>`;
  return layout({
    title: "Set a password",
    description: "Replace the default admin password.",
    settings: ctx.settings,
    path: "/admin/password",
    body,
    csrf: ctx.csrf,
    admin: true,
    robots: "noindex,nofollow",
    nonce: ctx.nonce,
    origin: ctx.origin,
  });
}

export function adminHome(ctx, { result, pendingCount }) {
  const rows = result.rows.length
    ? result.rows
        .map(
          (idea) => `<tr>
            <td><a href="/admin/ideas/${idea.id}">${escapeHtml(idea.title)}</a></td>
            <td>${statusPill(idea.status)}</td>
            <td class="num">${idea.votes}</td>
            <td>${escapeHtml(relativeTime(idea.created_at))}</td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="4">No ideas yet.</td></tr>`;
  const body = `<header class="page-head">
      <p class="eyebrow">Admin</p>
      <h1>Ideas</h1>
      <p class="lede">${pendingCount ? `${pendingCount} waiting for review.` : "Everything submitted to the board."}</p>
    </header>
    <p class="admin-links"><a href="/admin/changelog">Changelog</a><a href="/admin/settings">Settings</a><a href="/admin/export.csv">Export CSV</a></p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Idea</th><th>Status</th><th>Votes</th><th>Posted</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${pagination(result, (page) => `/admin?page=${page}`)}`;
  return layout({
    title: "Admin",
    description: "Manage feedback.",
    settings: ctx.settings,
    path: "/admin",
    body,
    csrf: ctx.csrf,
    admin: true,
    notice: ctx.notice,
    robots: "noindex,nofollow",
    nonce: ctx.nonce,
    origin: ctx.origin,
  });
}

export function adminIdeaPage(ctx, { idea, error = "" }) {
  const options = Object.entries(STATUSES)
    .map(([key, meta]) => `<option value="${key}"${idea.status === key ? " selected" : ""}>${escapeHtml(meta.label)}</option>`)
    .join("");
  const body = `<header class="page-head">
      <p class="eyebrow"><a href="/admin">Ideas</a></p>
      <h1>Edit idea</h1>
    </header>
    <form method="post" action="/admin/ideas/${idea.id}" class="panel stack">
      ${error ? `<p class="form-error" role="alert">${escapeHtml(error)}</p>` : ""}
      ${csrfField(ctx.csrf)}
      <label for="title">Title</label>
      <input id="title" name="title" required minlength="4" maxlength="140" value="${escapeHtml(idea.title)}">
      <label for="body">Details</label>
      <textarea id="body" name="body" maxlength="2000" rows="5">${escapeHtml(idea.body)}</textarea>
      <div class="split">
        <div>
          <label for="author_name">Name</label>
          <input id="author_name" name="author_name" maxlength="40" value="${escapeHtml(idea.author_name)}">
        </div>
        <div>
          <label for="status">Status</label>
          <select id="status" name="status">${options}</select>
        </div>
      </div>
      ${idea.author_email ? `<p class="hint">Email, only visible here: ${escapeHtml(idea.author_email)}</p>` : ""}
      <label for="reply">Team response</label>
      <textarea id="reply" name="reply" maxlength="4000" rows="4" placeholder="Optional note people will see on the idea.">${escapeHtml(idea.reply)}</textarea>
      <button class="primary" type="submit">Save</button>
    </form>
    <form method="post" action="/admin/ideas/${idea.id}/delete" class="danger-zone">
      ${csrfField(ctx.csrf)}
      <p>Deleting removes the idea and its votes.</p>
      <button class="danger" type="submit">Delete idea</button>
    </form>`;
  return layout({
    title: "Edit idea",
    description: "Edit an idea.",
    settings: ctx.settings,
    path: `/admin/ideas/${idea.id}`,
    body,
    csrf: ctx.csrf,
    admin: true,
    robots: "noindex,nofollow",
    nonce: ctx.nonce,
    origin: ctx.origin,
  });
}

export function adminChangelogPage(ctx, { releases, error = "", form = {} }) {
  const list = releases.length
    ? releases
        .map(
          (release) => `<li>
            <div><strong>${escapeHtml(release.version)}</strong> ${escapeHtml(release.title)}<br><span class="meta">${escapeHtml(formatDate(release.published_at))}</span></div>
            <form method="post" action="/admin/releases/${release.id}/delete">${csrfField(ctx.csrf)}<button class="text-button" type="submit">Delete</button></form>
          </li>`,
        )
        .join("")
    : "<li>No entries yet.</li>";
  const body = `<header class="page-head"><p class="eyebrow"><a href="/admin">Admin</a></p><h1>Changelog</h1></header>
    <form method="post" action="/admin/releases" class="panel stack">
      ${error ? `<p class="form-error" role="alert">${escapeHtml(error)}</p>` : ""}
      ${csrfField(ctx.csrf)}
      <div class="split">
        <div>
          <label for="version">Version</label>
          <input id="version" name="version" required maxlength="20" value="${escapeHtml(form.version || "")}" placeholder="1.2.0">
        </div>
        <div>
          <label for="title">Title</label>
          <input id="title" name="title" required maxlength="120" value="${escapeHtml(form.title || "")}">
        </div>
      </div>
      <label for="body">Notes</label>
      <textarea id="body" name="body" required maxlength="8000" rows="6" placeholder="Blank line between paragraphs. Start a line with - for a list. **bold** works.">${escapeHtml(form.body || "")}</textarea>
      <button class="primary" type="submit">Publish</button>
    </form>
    <ul class="admin-list">${list}</ul>`;
  return layout({
    title: "Changelog admin",
    description: "Publish changelog entries.",
    settings: ctx.settings,
    path: "/admin/changelog",
    body,
    csrf: ctx.csrf,
    admin: true,
    notice: ctx.notice,
    robots: "noindex,nofollow",
    nonce: ctx.nonce,
    origin: ctx.origin,
  });
}

export function settingsPage(ctx, { error = "", passwordError = "" } = {}) {
  const moderation = ctx.settings.moderation === "on";
  const body = `<header class="page-head"><p class="eyebrow"><a href="/admin">Admin</a></p><h1>Settings</h1></header>
    <form method="post" action="/admin/settings" class="panel stack">
      ${error ? `<p class="form-error" role="alert">${escapeHtml(error)}</p>` : ""}
      ${csrfField(ctx.csrf)}
      <label for="board_name">Board name</label>
      <input id="board_name" name="board_name" required maxlength="40" value="${escapeHtml(ctx.settings.board_name || "")}">
      <label for="tagline">Headline</label>
      <input id="tagline" name="tagline" required maxlength="120" value="${escapeHtml(ctx.settings.tagline || "")}">
      <label for="description">Description</label>
      <textarea id="description" name="description" maxlength="300" rows="3">${escapeHtml(ctx.settings.description || "")}</textarea>
      <label for="project_url">Project URL <span class="optional">footer credit</span></label>
      <input id="project_url" name="project_url" type="url" maxlength="300" value="${escapeHtml(ctx.settings.project_url || "")}" placeholder="https://github.com/you/quordiscuss">
      <label class="check"><input type="checkbox" name="moderation" value="on"${moderation ? " checked" : ""}> Review ideas before they appear on the board</label>
      <button class="primary" type="submit">Save settings</button>
    </form>
    <form method="post" action="/admin/password" class="panel stack">
      <h2>Password</h2>
      ${passwordError ? `<p class="form-error" role="alert">${escapeHtml(passwordError)}</p>` : ""}
      ${csrfField(ctx.csrf)}
      <label for="current_password">Current password</label>
      <input id="current_password" name="current_password" type="password" required autocomplete="current-password">
      <label for="new_password">New password</label>
      <input id="new_password" name="new_password" type="password" required minlength="10" autocomplete="new-password">
      <button class="primary" type="submit">Update password</button>
    </form>`;
  return layout({
    title: "Settings",
    description: "Board settings.",
    settings: ctx.settings,
    path: "/admin/settings",
    body,
    csrf: ctx.csrf,
    admin: true,
    notice: ctx.notice,
    robots: "noindex,nofollow",
    nonce: ctx.nonce,
    origin: ctx.origin,
  });
}

export function messagePage(ctx, { statusTitle, text, code = 404 }) {
  return {
    status: code,
    html: layout({
      title: statusTitle,
      description: text,
      settings: ctx.settings || { board_name: PRODUCT_NAME, description: text },
      path: ctx.path || "/",
      body: `<div class="empty"><h1>${escapeHtml(statusTitle)}</h1><p>${escapeHtml(text)}</p><p><a href="/">Back to the board</a></p></div>`,
      csrf: ctx.csrf || "",
      admin: Boolean(ctx.admin),
      robots: "noindex,nofollow",
      nonce: ctx.nonce || "",
      origin: ctx.origin || "",
    }),
  };
}

function websiteJsonLd(ctx) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: ctx.settings.board_name || PRODUCT_NAME,
    description: ctx.settings.description || "",
    url: `${ctx.origin}/`,
  };
}

export function rssXml(ctx, releases) {
  const items = releases
    .map((release) => {
      const link = `${ctx.origin}/changelog#release-${release.id}`;
      return `<item>
        <title>${escapeHtml(release.title)}</title>
        <link>${escapeHtml(link)}</link>
        <guid>${escapeHtml(link)}</guid>
        <pubDate>${escapeHtml(new Date(release.published_at).toUTCString())}</pubDate>
        <description>${escapeHtml(release.body)}</description>
      </item>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeHtml(ctx.settings.board_name)} changelog</title>
    <link>${escapeHtml(ctx.origin)}/changelog</link>
    <description>${escapeHtml(ctx.settings.description || "")}</description>
    ${items}
  </channel>
</rss>`;
}

export function sitemapXml(origin, ideas) {
  const urls = ["/", "/roadmap", "/changelog", ...ideas.map((idea) => `/ideas/${idea.id}`)]
    .map((pathname) => `<url><loc>${escapeHtml(origin + pathname)}</loc></url>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}
