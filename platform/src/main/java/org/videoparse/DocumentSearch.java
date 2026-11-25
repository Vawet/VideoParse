package org.videoparse;

import java.util.*;
import org.slf4j.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
class DocumentSearch {
    record Passage(String docId,String name,int ordinal,String heading,int firstLine,int lastLine,String body) {
        VectorIndex.DocHit key() { return new VectorIndex.DocHit(docId,ordinal); }
    }
    record Result(List<Passage> hits,boolean usedVectors) {}
    private static final String SELECT="""
        SELECT c.doc_id,d.name,c.ordinal_no AS ordinal,c.heading,c.first_line,c.last_line,c.body
        FROM vp_doc_chunk c JOIN vp_document d ON d.id=c.doc_id WHERE d.owner_id=?
        """;
    private final JdbcClient db;
    private final VectorIndex vectors;
    private final Logger log=LoggerFactory.getLogger(getClass());
    DocumentSearch(JdbcClient db,VectorIndex vectors) { this.db=db; this.vectors=vectors; }

    List<Passage> opening(String owner,String doc) {
        return db.sql(SELECT+" AND d.id=? ORDER BY c.ordinal_no LIMIT 5")
            .params(owner,doc).query(Passage.class).list();
    }

    Result search(String owner,String doc,String question) {
        var args=new ArrayList<Object>();
        args.add(owner);
        String scope=SELECT;
        if (doc!=null) { scope+=" AND d.id=?"; args.add(doc); }
        var lexicalArgs=new ArrayList<>(args);
        lexicalArgs.add(question);
        lexicalArgs.add(question);
        String match="MATCH(c.heading,c.body) AGAINST(? IN NATURAL LANGUAGE MODE)";
        var lexical=db.sql(scope+" AND "+match+" ORDER BY "+match+" DESC,c.doc_id,c.ordinal_no LIMIT 24")
            .params(lexicalArgs).query(Passage.class).list();

        var rows=new LinkedHashMap<VectorIndex.DocHit,Passage>();
        lexical.forEach(row->rows.put(row.key(),row));
        List<VectorIndex.DocHit> dense=List.of();
        if (vectors.configured()) try {
            var readyArgs=new ArrayList<>(args);
            readyArgs.add(vectors.space());
            var readyDocs=db.sql("SELECT id FROM vp_document WHERE owner_id=?" + (doc==null?"":" AND id=?") +
                    " AND index_state='ready' AND vector_space=?").params(readyArgs).query(String.class).list();
            if (!readyDocs.isEmpty()) dense=vectors.documents(owner,readyDocs,question);
        } catch (Exception ex) { log.warn("文档检索回退全文索引 ({})",ex.getClass().getSimpleName()); }
        var visibleDense=new HashSet<VectorIndex.DocHit>();
        if (!dense.isEmpty()) {
            String tuples=String.join(",",Collections.nCopies(dense.size(),"(?,?)"));
            args.add(vectors.space());
            for (var hit:dense) { args.add(hit.doc()); args.add(hit.ordinal()); }
            // Hydrate hits from the authoritative owner's corpus, including when reading a shared vector collection.
            db.sql(scope+" AND d.vector_space=? AND d.index_state='ready' AND (c.doc_id,c.ordinal_no) IN ("+tuples+")")
                .params(args).query(Passage.class).list().forEach(row->{
                    rows.put(row.key(),row);
                    visibleDense.add(row.key());
                });
        }
        var scores=new LinkedHashMap<VectorIndex.DocHit,Double>();
        boolean used=false;
        for (int i=0;i<dense.size();i++) if(visibleDense.contains(dense.get(i))) {
            scores.merge(dense.get(i),1.0/(61+i),Double::sum);
            used=true;
        }
        for (int i=0;i<lexical.size();i++) scores.merge(lexical.get(i).key(),1.0/(61+i),Double::sum);
        var hits=scores.entrySet().stream().sorted(Map.Entry.<VectorIndex.DocHit,Double>comparingByValue().reversed())
            .limit(5).map(e->rows.get(e.getKey())).toList();
        return new Result(hits,used);
    }
}
