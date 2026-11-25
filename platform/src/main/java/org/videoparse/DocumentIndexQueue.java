package org.videoparse;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
class DocumentIndexQueue {
    record Task(String id, String ownerId, int indexedChunks, int chunks, int failures) {}

    private final JdbcClient db;

    DocumentIndexQueue(JdbcClient db) { this.db = db; }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Task claim(String space, String lease) {
        // A different embedding space needs every chunk again, including previously failed documents.
        var task = db.sql("""
            SELECT id,owner_id,0 AS indexed_chunks,chunks,0 AS failures
            FROM vp_document FORCE INDEX (ix_document_index_queue) WHERE vector_space<>?
            ORDER BY vector_space,index_state,due_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
            """).param(space).query(Task.class).optional().orElse(null);
        if (task == null) {
            task = db.sql("""
                SELECT id,owner_id,indexed_chunks,chunks,failures
                FROM vp_document FORCE INDEX (ix_document_index_queue)
                WHERE vector_space=? AND index_state IN ('indexing','pending') AND due_at<=CURRENT_TIMESTAMP(3)
                ORDER BY index_state,due_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
                """).param(space).query(Task.class).optional().orElse(null);
        }
        if (task == null) return null;
        db.sql("""
            UPDATE vp_document SET vector_space=?,indexed_chunks=?,failures=?,lease=?,index_state='indexing',
                due_at=TIMESTAMPADD(MINUTE,3,CURRENT_TIMESTAMP(3)) WHERE id=?
            """).params(space, task.indexedChunks(), task.failures(), lease, task.id()).update();
        return task;
    }
}
