ALTER TABLE videos
    ADD library_generation BIGINT NOT NULL DEFAULT 0,
    ADD library_state VARCHAR(12) NOT NULL DEFAULT 'pending',
    ADD library_attempts INT NOT NULL DEFAULT 0,
    ADD library_after DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD INDEX ix_video_library_work(folder_id,library_state,library_after);

CREATE TABLE vp_video_passage (
    video_id VARCHAR(64) NOT NULL,
    passage_key CHAR(64) NOT NULL,
    origin VARCHAR(16) NOT NULL,
    start_sec DOUBLE,
    end_sec DOUBLE,
    frame_name VARCHAR(240),
    heading VARCHAR(500) NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY(video_id,passage_key),
    FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE,
    FULLTEXT INDEX search_text(heading,body) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Existing document rows keep their original identity, foreign key and recall schedule.
ALTER TABLE vp_doc_review
    MODIFY doc_id CHAR(32) NULL,
    ADD video_id VARCHAR(64),
    ADD passage_key CHAR(64),
    ADD saved_quote TEXT,
    ADD quote_first_line INT,
    ADD quote_last_line INT,
    ADD UNIQUE(video_id,passage_key),
    ADD FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE,
    ADD CHECK ((doc_id IS NOT NULL AND video_id IS NULL AND passage_key IS NULL)
            OR (doc_id IS NULL AND video_id IS NOT NULL AND passage_key IS NOT NULL));
