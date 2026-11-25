CREATE TABLE vp_job (
  id CHAR(32) PRIMARY KEY,
  video_id VARCHAR(64) NOT NULL,
  active_video VARCHAR(64) UNIQUE,
  status VARCHAR(16) NOT NULL,
  error TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX runnable (status,created_at)
);
CREATE TABLE vp_event (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  job_id CHAR(32) NOT NULL,
  payload JSON NOT NULL,
  FOREIGN KEY (job_id) REFERENCES vp_job(id),
  INDEX replay (job_id,id)
);
