package org.videoparse;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/v2/documents")
class DocumentReviewController {
    private final JdbcClient db;
    private final Visitor visitor;

    DocumentReviewController(JdbcClient db, Visitor visitor) {
        this.db = db;
        this.visitor = visitor;
    }

    record Add(String question) {}
    record Rating(Integer revision, String rating) {}
    record Card(String id, String docId, String name, int firstLine, int lastLine, String body,
                String question, int revision, long dueEpoch, int dueCount, int total) {}
    record Queue(boolean success, Card next) {}

    @GetMapping("/review")
    Queue queue() {
        var first = db.sql("""
            SELECT r.id, r.doc_id, d.name, c.first_line, c.last_line, c.body, r.question, r.revision,
                UNIX_TIMESTAMP(r.due_at) AS due_epoch,
                SUM(r.due_at <= CURRENT_TIMESTAMP(3)) OVER () AS due_count, COUNT(*) OVER () AS total
            FROM vp_doc_review r JOIN vp_document d ON d.id = r.doc_id
            JOIN vp_doc_chunk c ON c.doc_id = r.doc_id AND c.ordinal_no = r.ordinal_no
            WHERE d.owner_id = ? ORDER BY r.due_at, r.id LIMIT 1
            """).param(visitor.id()).query(Card.class).optional();
        return new Queue(true, first.orElse(null));
    }

    @PostMapping("/{doc}/chunks/{ordinal}/review")
    Map<String, Object> add(@PathVariable String doc, @PathVariable int ordinal, @RequestBody Add body) {
        if (body.question() == null || body.question().isBlank() || body.question().length() > 1000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "复习问题需要 1 至 1000 字");
        String owner = visitor.id();
        var chunk = db.sql("""
            SELECT 1 FROM vp_doc_chunk c JOIN vp_document d ON d.id = c.doc_id
            WHERE d.owner_id = ? AND c.doc_id = ? AND c.ordinal_no = ?
            """).params(owner, doc, ordinal).query(Integer.class).optional();
        if (chunk.isEmpty()) throw DocumentLibrary.missing();
        db.sql("""
            INSERT INTO vp_doc_review(id, doc_id, ordinal_no, question) VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE id = id
            """).params(DocumentLibrary.id(), doc, ordinal, body.question().strip()).update();
        return Map.of("success", true);
    }

    private static final int[] RECALL_DAYS = {1, 3, 7, 14, 30};
    record Progress(int revision, int streak, boolean due) {}

    @Transactional
    @PostMapping("/review/{id}/rate")
    public Map<String, Object> rate(@PathVariable String id, @RequestBody Rating body) {
        if (body.revision() == null || body.revision() < 0 ||
                !("again".equals(body.rating()) || "remembered".equals(body.rating())))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "复习反馈无效");
        boolean remembered = "remembered".equals(body.rating());
        var progress = db.sql("""
            SELECT r.revision, r.streak, r.due_at <= CURRENT_TIMESTAMP(3) AS due
            FROM vp_doc_review r JOIN vp_document d ON d.id = r.doc_id
            WHERE d.owner_id = ? AND r.id = ? FOR UPDATE
            """).params(visitor.id(), id).query(Progress.class).optional().orElseThrow(DocumentLibrary::missing);
        if (progress.revision() != body.revision() || !progress.due())
            throw new ResponseStatusException(HttpStatus.CONFLICT, "这张卡片的复习时间已更新");
        int streak = remembered ? Math.min(progress.streak() + 1, RECALL_DAYS.length) : 0;
        int minutes = remembered ? 1440 * RECALL_DAYS[streak - 1] : 10;
        db.sql("""
            UPDATE vp_doc_review SET due_at = TIMESTAMPADD(MINUTE, ?, CURRENT_TIMESTAMP(3)),
                streak = ?, revision = revision + 1 WHERE id = ?
            """).params(minutes, streak, id).update();
        return Map.of("success", true);
    }

    @DeleteMapping("/review/{id}")
    Map<String, Object> remove(@PathVariable String id) {
        db.sql("""
            DELETE r FROM vp_doc_review r JOIN vp_document d ON d.id = r.doc_id WHERE d.owner_id = ? AND r.id = ?
            """).params(visitor.id(), id).update();
        return Map.of("success", true);
    }
}
