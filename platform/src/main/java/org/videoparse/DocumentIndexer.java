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
    private final DocumentIndexQueue queue;
    private final Logger log=LoggerFactory.getLogger(getClass());
    DocumentIndexer(JdbcClient db,VectorIndex vectors,DocumentIndexQueue queue) {
        this.db=db; this.vectors=vectors; this.queue=queue;
    }

    @Scheduled(fixedDelayString="${DOCUMENT_INDEX_MS:2000}")
    void run() {
        if (!vectors.configured()) return;
        String lease=DocumentLibrary.id();
        var task=queue.claim(vectors.space(),lease);
        if (task==null) return;
        try {
            List<MarkdownSections.Chunk> chunks=db.sql("""
                SELECT ordinal_no AS ordinal,heading,first_line,last_line,body FROM vp_doc_chunk
                WHERE doc_id=? AND ordinal_no>=? ORDER BY ordinal_no LIMIT 24
                """).params(task.id(),task.indexedChunks()).query(MarkdownSections.Chunk.class).list();
            if (chunks.isEmpty()) throw new IllegalStateException("缺少文档分段");
            vectors.indexDocument(task.ownerId(),task.id(),chunks);
            queue.completeBatch(task, lease, chunks.size());
        } catch (LocalEmbeddings.Busy busy) {
            queue.deferBusy(task, lease);
        } catch (Exception e) {
            if (Thread.currentThread().isInterrupted()) return;
            log.warn("文档向量化失败 {} (第 {} 次): {}",task.id(),task.failures()+1,e.getClass().getSimpleName());
            queue.recordFailure(task, lease);
        }
    }
}
