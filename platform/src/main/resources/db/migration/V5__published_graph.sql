-- Readers switch to a graph snapshot in the same transaction as the terminal task event.
CREATE TABLE vp_graph_head (
    video_id VARCHAR(64) PRIMARY KEY,
    job_id CHAR(32) NOT NULL,
    FOREIGN KEY (job_id) REFERENCES vp_job(id)
);
