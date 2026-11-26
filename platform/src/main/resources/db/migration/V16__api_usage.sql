CREATE TABLE vp_api_usage (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    owner_id VARCHAR(32) NOT NULL,
    started_ms BIGINT NOT NULL,
    operation VARCHAR(80) NOT NULL,
    provider VARCHAR(255) NOT NULL,
    model VARCHAR(200) NOT NULL,
    status VARCHAR(16) NOT NULL,
    input_tokens BIGINT,
    output_tokens BIGINT,
    total_tokens BIGINT,
    estimated_usd_micros BIGINT,
    INDEX ix_api_usage_owner (owner_id, id)
);
