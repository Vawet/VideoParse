CREATE TABLE vp_doc_interview (
    id CHAR(32) PRIMARY KEY,
    doc_id CHAR(32) NOT NULL,
    ordinal_no INT NOT NULL,
    question VARCHAR(500) NOT NULL,
    points JSON NOT NULL,
    revision INT NOT NULL DEFAULT 0,
    answer TEXT,
    feedback JSON,
    practiced_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE(doc_id, ordinal_no),
    INDEX (practiced_at),
    FOREIGN KEY (doc_id, ordinal_no) REFERENCES vp_doc_chunk(doc_id, ordinal_no) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
