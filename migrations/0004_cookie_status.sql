-- Migration: Create cookie_status table
CREATE TABLE IF NOT EXISTS cookie_status (
    email TEXT PRIMARY KEY,
    label TEXT,
    status TEXT,
    expiry_at DATETIME,
    last_checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
