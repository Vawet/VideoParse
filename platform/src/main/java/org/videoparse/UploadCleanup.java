package org.videoparse;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
class UploadCleanup {
    private final JdbcClient db;
    private final MediaStore store;
    private final TransactionTemplate tx;
    UploadCleanup(JdbcClient db,MediaStore store,TransactionTemplate tx){this.db=db;this.store=store;this.tx=tx;}

    @Scheduled(fixedDelayString="${UPLOAD_CLEANUP_MS:600000}")
    public void expire() {
        var expired=db.sql("SELECT id FROM vp_upload WHERE (complete AND NOT cleaned) OR (NOT complete AND updated_at < NOW() - INTERVAL 2 DAY) LIMIT 20")
            .query(String.class).list();
        for(var id:expired) tx.executeWithoutResult(ignored -> {
            var rows=db.sql("SELECT complete,JSON_LENGTH(hashes) AS n FROM vp_upload WHERE id=? AND ((complete AND NOT cleaned) OR (NOT complete AND updated_at < NOW() - INTERVAL 2 DAY)) FOR UPDATE")
                .param(id).query((rs,i)->new Expired(rs.getBoolean(1),rs.getInt(2))).list();
            if(rows.isEmpty()) return;
            var row=rows.getFirst();
            try {for(int i=0;i<row.count();i++) store.removePart(id,i);}
            catch(Exception error){throw new IllegalStateException("清理分片失败，将再次尝试",error);}
            if(row.complete()) db.sql("UPDATE vp_upload SET cleaned=true WHERE id=?").param(id).update();
            else db.sql("DELETE FROM vp_upload WHERE id=?").param(id).update();
        });
    }
    private record Expired(boolean complete,int count){}
}
