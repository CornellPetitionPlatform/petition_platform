CREATE TABLE IF NOT EXISTS petition_likes (
  petition_slug TEXT PRIMARY KEY,
  likes INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS petition_like_votes (
  petition_slug TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (petition_slug, user_id_hash)
);

CREATE TABLE IF NOT EXISTS rate_limiter_hits (
  rate_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
