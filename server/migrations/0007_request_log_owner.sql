-- Request-log owner: name the customer on every row, and drop the two indexes
-- v6 shipped before they were measured.
--
-- v6 created `idx_request_logs_status` and `idx_request_logs_key`, but they are
-- already recorded on deployed files, so the correction is a version of its own
-- rather than an edit a migration runner would never replay. The status index
-- made the dashboard's `success` filter 300x slower: its leading column is a
-- non-selective range, so SQLite abandoned the ordered `created_at` scan and
-- sorted the whole match set. The key index served no query at all.
DROP INDEX IF EXISTS idx_request_logs_status;
DROP INDEX IF EXISTS idx_request_logs_key;

-- Attribution: the gateway copies the key's owner onto the row, so a deleted
-- key no longer takes its request history with it. Rows written before that
-- column was filled are repaired from the keys that still exist.
UPDATE request_logs
   SET user_id = (SELECT k.user_id FROM api_keys k WHERE k.id = request_logs.api_key_id)
 WHERE user_id IS NULL
   AND api_key_id IS NOT NULL;
