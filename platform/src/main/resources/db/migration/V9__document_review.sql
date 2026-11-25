CREATE TABLE vp_doc_review (
    id CHAR(32) PRIMARY KEY,
    doc_id CHAR(32) NOT NULL,
    ordinal_no INT NOT NULL,
    question VARCHAR(1000) NOT NULL,
    due_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    streak INT NOT NULL DEFAULT 0,
    revision INT NOT NULL DEFAULT 0,
    UNIQUE(doc_id, ordinal_no),
    FOREIGN KEY(doc_id, ordinal_no) REFERENCES vp_doc_chunk(doc_id, ordinal_no) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
