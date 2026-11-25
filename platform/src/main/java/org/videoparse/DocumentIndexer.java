package org.videoparse;

import java.util.List;
import org.slf4j.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
class DocumentIndexer {
    private final JdbcClient db;
    private final VectorIndex vectors;
    private final Logger log=LoggerFactory.getLogger(getClass());
    DocumentIndexer(JdbcClient db,VectorIndex vectors) { this.db=db; this.vectors=vectors; }
    record Task(String id,String ownerId,int indexedChunks,int chunks,int failures) {}

    @Scheduled(fixedDelayString="${DOCUMENT_INDEX_MS:2000}")
    void run() {
        db.sql("""
            UPDATE vp_document SET index_state='pending',indexed_chunks=0,failures=0,lease=NULL,
                due_at=CURRENT_TIMESTAMP(3),vector_space=? WHERE vector_space<>?
            """).params(vectors.space(),vectors.space()).update();
        var row=db.sql("""
            SELECT id,owner_id,indexed_chunks,chunks,failures FROM vp_document WHERE index_state IN ('pending','indexing')
            AND due_at<=CURRENT_TIMESTAMP(3) ORDER BY due_at,id LIMIT 1
            """).query(Task.class).optional();
        if (row.isEmpty()) return;
        Task task=row.get();
        String lease=DocumentLibrary.id();
        if (db.sql("""
                UPDATE vp_document SET lease=?,index_state='indexing',due_at=TIMESTAMPADD(MINUTE,3,CURRENT_TIMESTAMP(3))
                WHERE id=? AND indexed_chunks=? AND index_state IN ('pending','indexing') AND due_at<=CURRENT_TIMESTAMP(3)
                """).params(lease,task.id(),task.indexedChunks()).update()==0) return;
        try {
            List<MarkdownSections.Chunk> chunks=db.sql("""
                SELECT ordinal_no AS ordinal,heading,first_line,last_line,body FROM vp_doc_chunk
                WHERE doc_id=? AND ordinal_no>=? ORDER BY ordinal_no LIMIT 24
                """).params(task.id(),task.indexedChunks()).query(MarkdownSections.Chunk.class).list();
            if (chunks.isEmpty()) throw new IllegalStateException("缺少文档分段");
            vectors.indexDocument(task.ownerId(),task.id(),chunks);
            int next=task.indexedChunks()+chunks.size();
            db.sql("""
                UPDATE vp_document SET indexed_chunks=?,index_state=?,failures=0,lease=NULL,due_at=CURRENT_TIMESTAMP(3)
                WHERE id=? AND lease=?
                """).params(next,next==task.chunks()?"ready":"pending",task.id(),lease).update();
        } catch (Exception e) {
            if (Thread.currentThread().isInterrupted()) return;
            int failures=task.failures()+1;
            log.warn("文档向量化失败 {} (第 {} 次): {}",task.id(),failures,e.getClass().getSimpleName());
            db.sql("""
                UPDATE vp_document SET failures=?,index_state=?,lease=NULL,due_at=TIMESTAMPADD(SECOND,?,CURRENT_TIMESTAMP(3))
                WHERE id=? AND lease=?
                """).params(failures,failures>=5?"error":"pending",15*(1<<failures),task.id(),lease).update();
        }
    }
}
