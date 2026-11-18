-- add the password_resets table ("Forgot password?" codes)
-- At most one code per account: a new request replaces the old one. Only a
-- salted scrypt hash of the 6-digit code is stored (like passwords), with
-- when it stops working (UTC epoch ms) and how many wrong codes were tried
-- (services/passwordReset.js gives up after 5). Deleting the account
-- deletes its code.
CREATE TABLE IF NOT EXISTS password_resets (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
