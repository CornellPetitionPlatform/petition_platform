# Petition Likes API (Cloudflare Worker + D1)

This Worker stores and returns like counts for petition pages.

## Endpoints

- `GET /likes/:slug` returns current likes
- `POST /likes/:slug` increments likes by 1 and returns the new count
  - Requires header: `X-Client-Id: <stable-random-id>`
  - Enforces one like per petition per `X-Client-Id`
  - Rate-limited (defaults: 20 requests per 10 minutes per petition/IP/client)

Response shape:

```json
{
  "petition_slug": "petition-1",
  "likes": 3,
  "liked": true
}
```

If a client already liked that petition:

```json
{
  "petition_slug": "petition-1",
  "likes": 3,
  "liked": false
}
```

## Deploy

1. Install Wrangler if needed:

```bash
npm install -g wrangler
```

2. Authenticate:

```bash
wrangler login
```

3. Create D1 database:

```bash
cd cloudflare/likes-api
wrangler d1 create petition-likes
```

4. Copy the returned `database_id` into `wrangler.toml` (`database_id = "..."`).

5. Apply schema:

```bash
wrangler d1 execute petition-likes --file=schema.sql
```

If you already created the DB earlier, run this command again to add the new tables (`CREATE TABLE IF NOT EXISTS` is safe to re-run).

6. Deploy Worker:

```bash
wrangler deploy
```

7. Copy deployed Worker URL and set it in Jekyll config:

- Edit `/Users/isabelcorpus/Desktop/petition_platform/_config.yml`
- Set `likes_api_url` to your Worker URL (for example `https://petition-likes-api.<subdomain>.workers.dev`)

8. If your site URL differs from `https://cornellpetitionplatform.github.io`, update `ALLOWED_ORIGIN` in `wrangler.toml` and redeploy.

## Config

`wrangler.toml` variables:

- `ALLOWED_ORIGIN`: comma-separated browser origins allowed for CORS.
- `RATE_LIMIT_WINDOW_SECONDS`: limiter window size (default `600`).
- `RATE_LIMIT_MAX_REQUESTS`: max POST requests allowed in each window (default `20`).

## Local development (`jekyll serve`)

1. Run the Worker locally:

```bash
cd /Users/isabelcorpus/Desktop/petition_platform/cloudflare/likes-api
wrangler dev --port 8787
```

2. In another terminal, run Jekyll:

```bash
cd /Users/isabelcorpus/Desktop/petition_platform
bundle exec jekyll serve
```

When `site.likes_api_url` is empty and the site runs on localhost, the petition page automatically uses `http://127.0.0.1:8787`.
