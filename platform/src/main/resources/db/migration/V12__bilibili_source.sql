CREATE TABLE vp_bilibili_source (
    video_id VARCHAR(64) PRIMARY KEY,
    aid BIGINT NOT NULL,
    bvid VARCHAR(20) NOT NULL,
    page_no INT NOT NULL,
    analysis JSON,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
