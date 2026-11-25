ALTER TABLE vp_dispatch
    ADD COLUMN stage VARCHAR(8) NOT NULL DEFAULT 'parse',
    ADD COLUMN attempt INT NOT NULL DEFAULT 0,
    DROP PRIMARY KEY, ADD PRIMARY KEY (job_id, stage);

ALTER TABLE vp_job
    ADD COLUMN publish_attempts INT NOT NULL DEFAULT 0,
    ADD COLUMN publish_after TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD INDEX publish_due (status, publish_after);
