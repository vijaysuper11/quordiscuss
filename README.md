# QuorDiscuss

Self-hosted feedback board, public roadmap, and changelog. Collect ideas, let people vote, and publish what shipped. One container, a SQLite file, no accounts for voters.

QuorDiscuss is for indie SaaS founders, agencies, and open-source maintainers who want a Canny or Featurebase style board on a server they control. People run their own copy from this repository. A public demo on your domain is optional.

[![Deploy on Hostinger](https://assets.hostinger.com/vps/deploy.svg)](https://www.hostinger.com/in/docker-hosting?compose_url=https://raw.githubusercontent.com/vijaysuper11/quordiscuss/refs/heads/main/docker-compose.yml&REFERRALCODE=FUXVIJAYSVD7)

The button uses referral code `FUXVIJAYSVD7`. Anyone who deploys through it gets a Hostinger discount at checkout.

## What you get

- Public board with titles, details, and one vote per browser
- Sort by top or new, filter by status, and search
- Roadmap lanes for planned, building, and shipped ideas
- Changelog with an RSS feed at `/changelog.xml`
- Admin status changes, team replies, CSV export, and optional moderation
- Sitemap and crawlable HTML, so the board itself can be indexed

Emails are optional and shown only in the admin export. Votes are tied to a cookie, not an account.

## Run it

Docker is the path that matches the Hostinger button.

```bash
git clone https://github.com/vijaysuper11/quordiscuss.git
cd quordiscuss
export ADMIN_PASSWORD='use-a-long-password'
docker compose up --build
```

Open `http://localhost:8080`. Sign in at `/admin/login`.

If `ADMIN_PASSWORD` is left as `changeme`, the first admin visit asks you to replace it before you can manage ideas. Data lives in the `quorum_data` volume.

Without Docker, Node.js 22.13 or newer is enough:

```bash
ADMIN_PASSWORD='use-a-long-password' node src/server.js
```

The database file is created in `./data`.

### Configuration

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | First admin password. Required. `changeme` forces a reset on first login. |
| `BOARD_NAME` | Name in the header. Editable later in settings. |
| `BOARD_TAGLINE` | Headline on the board. |
| `BOARD_DESCRIPTION` | Short description under the headline and in meta tags. |
| `APP_URL` | Public origin, such as `https://feedback.example.com`, for canonical links, the sitemap, and RSS. |
| `PROJECT_URL` | Footer link, usually your GitHub repository. |
| `PORT` | Defaults to `8080`. |
| `DATA_DIR` | SQLite directory. Defaults to `./data`, or `/data` in Docker. |
| `TRUST_PROXY` | Set to `1` behind a reverse proxy so rate limits see the visitor address. |
| `RESET_ADMIN_PASSWORD` | Set to `1` for one boot to replace the stored admin password with `ADMIN_PASSWORD`. Remove it after. |
| `SESSION_SECRET` | Optional. A random secret is stored in the data directory when this is unset. |

Forgot the password and you still have the server: set a new `ADMIN_PASSWORD`, set `RESET_ADMIN_PASSWORD=1`, start once, then remove the reset flag. That keeps ideas in place.

A small VPS is enough. The app is one Node process and one SQLite file.

## Maintainer setup

Do this before you publish the repository or share the deploy button.

1. The public repository is [vijaysuper11/quordiscuss](https://github.com/vijaysuper11/quordiscuss). Hostinger downloads `docker-compose.yml` and builds the image from that Git URL.
2. The button already includes referral code `FUXVIJAYSVD7` from [the India referral link](https://www.hostinger.com/in?REFERRALCODE=FUXVIJAYSVD7).
3. In the running app, set **Project URL** in Admin → Settings to the repository so the footer credit points at it.

The button format is the one Hostinger documents for Docker hosting:

```md
[![Deploy on Hostinger](https://assets.hostinger.com/vps/deploy.svg)](https://www.hostinger.com/in/docker-hosting?compose_url=https://raw.githubusercontent.com/vijaysuper11/quordiscuss/refs/heads/main/docker-compose.yml&REFERRALCODE=FUXVIJAYSVD7)
```

Commission is paid by Hostinger’s referral program, not by this app. You earn 20% of a new customer’s first eligible hosting purchase after they stay active for 45 days. Domain purchases do not count. Confirm the current terms in your Hostinger referral dashboard before you rely on a number.

## FAQ

### Where is the data stored?

In a SQLite file inside `DATA_DIR` (`quorum.db`), plus a generated `session.secret`. Docker keeps both in the `quorum_data` volume. Copy that volume if you move servers.

### Can people vote more than once?

Once per browser. Clearing cookies creates a new voter. There are no user accounts.

### Can I hide new ideas until I approve them?

Yes. In Admin → Settings, turn on review. New ideas stay off the public board, roadmap, and sitemap until you change the status.

### How do I write a changelog entry?

In Admin → Changelog, a blank line starts a new paragraph, a line starting with `- ` becomes a list, and `**double asterisks**` become bold. HTML is escaped.

## Development

```bash
npm test
```

Tests cover voting, private pending ideas, password hashing, and escaping. They do not need a running server.

## License

MIT. See [LICENSE](LICENSE).
