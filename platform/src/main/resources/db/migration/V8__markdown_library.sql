CREATE TABLE vp_document (
    id CHAR(32) PRIMARY KEY,
    owner_id CHAR(32) NOT NULL,
    digest CHAR(64) NOT NULL,
    name VARCHAR(240) NOT NULL,
    markdown MEDIUMTEXT NOT NULL,
    chunks INT NOT NULL,
    indexed_chunks INT NOT NULL DEFAULT 0,
    index_state VARCHAR(12) NOT NULL DEFAULT 'pending',
    vector_space VARCHAR(64) NOT NULL,
    failures INT NOT NULL DEFAULT 0,
    due_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    lease CHAR(32),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE(owner_id,digest), INDEX(index_state,due_at),
    FOREIGN KEY(owner_id) REFERENCES vp_visitor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE vp_doc_chunk (
    doc_id CHAR(32) NOT NULL,
    ordinal_no INT NOT NULL,
    heading VARCHAR(500) NOT NULL,
    first_line INT NOT NULL,
    last_line INT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY(doc_id,ordinal_no),
    FOREIGN KEY(doc_id) REFERENCES vp_document(id) ON DELETE CASCADE,
    FULLTEXT INDEX search_text(heading,body) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
