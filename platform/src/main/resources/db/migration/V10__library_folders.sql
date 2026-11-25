CREATE TABLE vp_library_folder (
    id VARCHAR(16) PRIMARY KEY,
    name VARCHAR(48) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO vp_library_folder(id,name) VALUES ('videos','视频'), ('documents','文档');

ALTER TABLE vp_document
    ADD folder_id VARCHAR(16) NOT NULL DEFAULT 'documents',
    ADD FOREIGN KEY (folder_id) REFERENCES vp_library_folder(id);

ALTER TABLE videos ADD folder_id VARCHAR(16),
    ADD FOREIGN KEY (folder_id) REFERENCES vp_library_folder(id),
    ADD INDEX ix_videos_library(owner_id,folder_id,created_at);
CREATE INDEX ix_job_video_status ON vp_job(video_id,status);

-- Earlier platform jobs and pre-platform analyses both precede folder assignment.
UPDATE videos v SET folder_id='videos'
WHERE EXISTS (SELECT 1 FROM vp_job j WHERE j.video_id=v.id AND j.status='done')
   OR (v.status='analyzed' AND NOT EXISTS (SELECT 1 FROM vp_job j WHERE j.video_id=v.id));
