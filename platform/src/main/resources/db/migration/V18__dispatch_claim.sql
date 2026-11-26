ALTER TABLE vp_dispatch
    ADD COLUMN available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN send_lease CHAR(36),
    ADD COLUMN send_failures INT NOT NULL DEFAULT 0,
    ADD INDEX ix_dispatch_available (available_at, created_at, job_id, stage);
