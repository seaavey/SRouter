ALTER TABLE request_logs ADD COLUMN request_id TEXT;
ALTER TABLE request_logs ADD COLUMN user_id TEXT;
ALTER TABLE request_logs ADD COLUMN method TEXT;
ALTER TABLE request_logs ADD COLUMN path TEXT;
ALTER TABLE request_logs ADD COLUMN error_code TEXT;
ALTER TABLE request_logs ADD COLUMN error_message TEXT;
ALTER TABLE request_logs ADD COLUMN legacy_id TEXT;
ALTER TABLE request_logs ADD COLUMN legacy_api_key_id TEXT;