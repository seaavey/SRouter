-- Request-log integrity: repair the key attribution the writer split across two
-- columns.
--
-- Before schema v6 the writer cast a key id to UUID before storing it, so
-- `api_key_id` held NULL on every row and the real id landed in
-- `legacy_api_key_id`. The backfill moves those values into the column the
-- queries, exports, and analytics read.
UPDATE request_logs
   SET api_key_id = legacy_api_key_id
 WHERE api_key_id IS NULL
   AND legacy_api_key_id IS NOT NULL;
