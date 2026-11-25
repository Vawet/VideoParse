package org.videoparse;

import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@Service
class DocumentLibrary {
    private final JdbcClient db;
    private final JdbcTemplate batch;
    private final VectorIndex vectors;
    private final Visitor visitor;
    DocumentLibrary(JdbcClient db,JdbcTemplate batch,VectorIndex vectors,Visitor visitor) {
        this.db=db; this.batch=batch; this.vectors=vectors; this.visitor=visitor;
    }
    static String id() { return UUID.randomUUID().toString().replace("-",""); }
    record Document(String id,String name,int chunks,int indexedChunks,String indexState) {}
    private JdbcClient.StatementSpec documentRows(String owner, String filter) {
        return db.sql("""
            SELECT id,name,chunks,CASE WHEN vector_space=:space THEN indexed_chunks ELSE 0 END AS indexed_chunks,
                CASE WHEN vector_space=:space THEN index_state ELSE 'pending' END AS index_state
            FROM vp_document WHERE owner_id=:owner AND
            """ + filter).param("owner",owner).param("space",vectors.space());
    }
    List<Document> list() {
        return documentRows(visitor.id(), "folder_id='documents' ORDER BY created_at DESC,id").query(Document.class).list();
    }
    Document require(String doc) {
        return documentRows(visitor.id(), "id=:doc").param("doc",doc)
            .query(Document.class).optional().orElseThrow(DocumentLibrary::missing);
    }
    static ResponseStatusException missing() { return new ResponseStatusException(HttpStatus.NOT_FOUND,"文档不存在"); }
    String markdown(String doc) {
        return db.sql("SELECT markdown FROM vp_document WHERE owner_id=? AND id=?")
            .params(visitor.id(),doc).query(String.class).optional().orElseThrow(DocumentLibrary::missing);
    }
    private static void validateName(String name) {
        if (name==null || !name.matches("(?i)[^/\\\\\\p{Cntrl}]{1,230}\\.(md|markdown)"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"请选择 .md 或 .markdown 文件");
    }

    @Transactional
    public Document rename(String doc, String name) {
        validateName(name);
        db.sql("UPDATE vp_document SET name=? WHERE id=? AND owner_id=?").params(name,doc,visitor.id()).update();
        return require(doc);
    }

    void delete(String doc) {
        String owner=visitor.id();
        if (db.sql("DELETE FROM vp_document WHERE id=? AND owner_id=?").params(doc,owner).update()==0)
            throw missing();
        vectors.removeDocument(owner,doc);
    }

    @Transactional(rollbackFor=Exception.class)
    public Document upload(MultipartFile file) throws Exception {
        String name=file.getOriginalFilename();
        validateName(name);
        if (file.getSize()>512*1024) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,"每份 Markdown 上限 512 KiB");
        String content;
        try { content=StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(file.getBytes())).toString(); }
        catch (CharacterCodingException e) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"文档需要 UTF-8 编码"); }
        content=content.replaceFirst("^\uFEFF","").replace("\r\n","\n").replace('\r','\n');
        if (content.isBlank() || content.indexOf(0)>=0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"文档需要包含 Markdown 文本");
        String owner=visitor.id(), proposed=id();
        String digest=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content.getBytes(StandardCharsets.UTF_8)));
        var chunks=MarkdownSections.split(content);
        if (chunks.size()>1800) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,"文档分段过多，请拆成多份笔记");
        db.sql("""
            INSERT INTO vp_document(id,owner_id,digest,name,markdown,chunks,vector_space) VALUES(?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE id=id
            """).params(proposed,owner,digest,name,content,chunks.size(),vectors.space()).update();
        Document actual=documentRows(owner, "digest=:digest FOR UPDATE").param("digest",digest).query(Document.class).single();
        if (proposed.equals(actual.id())) {
            batch.batchUpdate("INSERT INTO vp_doc_chunk(doc_id,ordinal_no,heading,first_line,last_line,body) VALUES(?,?,?,?,?,?)",
                chunks,100,(s,c)->{
                    s.setString(1,actual.id()); s.setInt(2,c.ordinal()); s.setString(3,c.heading());
                    s.setInt(4,c.firstLine()); s.setInt(5,c.lastLine()); s.setString(6,c.body());
                });
        }
        return actual;
    }

    Document retry(String doc) {
        db.sql("UPDATE vp_document SET index_state='pending',failures=0,due_at=CURRENT_TIMESTAMP(3) WHERE id=? AND owner_id=? AND index_state='error'")
            .params(doc,visitor.id()).update();
        return require(doc);
    }
}
