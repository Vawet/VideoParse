package org.videoparse;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.security.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class UploadService {
    static final int CHUNK=5*1024*1024;
    record Manifest(String filename,long bytes,List<String> hashes,String token) {}
    record Upload(String id,String video,String filename,long bytes,String hashes,boolean complete) {
        String storedName(){return video+filename.substring(filename.lastIndexOf('.')).toLowerCase(Locale.ROOT);}
    }
    private final JdbcClient db;
    private final ObjectMapper json;
    private final UploadGate gate;
    private final MediaStore store;
    private final Visitor visitor;
    private final Path directory;
    UploadService(JdbcClient db,ObjectMapper json,UploadGate gate,MediaStore store,Visitor visitor,@Value("${videoparse.data}") Path root) {
        this.visitor=visitor;this.db=db;this.json=json;this.gate=gate;this.store=store;this.directory=root.resolve("uploads");
    }
    private Upload get(UUID id,boolean lock) {
        return db.sql("SELECT * FROM vp_upload WHERE id=? AND owner_id=?"+(lock?" FOR UPDATE":"")).params(id.toString(),visitor.id()).query(Upload.class)
                .optional().orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"上传会话不存在"));
    }
    String begin(Manifest m) throws Exception {
        if(m.filename()==null || !m.filename().matches("(?i)[^/\\\\\\p{Cntrl}]{1,230}\\.(mp4|mkv|avi|mov|flv|webm|m4v)") ||
           m.bytes()<1 || m.bytes()>2048L*1024*1024 || m.hashes()==null ||
           m.hashes().size()!=(m.bytes()+CHUNK-1)/CHUNK || m.hashes().stream().anyMatch(x->x==null || !x.matches("[a-f0-9]{64}")))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"文件格式、大小或分片清单无效");
        gate.consume(m.token());
        String id=UUID.randomUUID().toString();
        db.sql("INSERT INTO vp_upload(id,video,filename,bytes,hashes,owner_id) VALUES(?,?,?,?,?,?)")
          .params(id,UUID.randomUUID().toString(),m.filename(),m.bytes(),json.writeValueAsString(m.hashes()),visitor.id()).update();
        return id;
    }
    List<Integer> parts(UUID id) {
        get(id,false);
        return db.sql("SELECT part_no FROM vp_part WHERE upload_id=? ORDER BY part_no").param(id.toString()).query(Integer.class).list();
    }
    @Transactional(rollbackFor=Exception.class)
    public void put(UUID id,int index,byte[] data) throws Exception {
        var u=get(id,true);
        if(u.complete()) return;
        var hashes=json.readTree(u.hashes());
        if(index<0 || index>=hashes.size() || data.length!=Math.min(CHUNK,u.bytes()-(long)index*CHUNK) ||
           !HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data)).equals(hashes.get(index).asText()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"分片大小或摘要不符");
        store.put(u.id(),index,data);
        db.sql("UPDATE vp_upload SET updated_at=CURRENT_TIMESTAMP WHERE id=?").param(u.id()).update();
        db.sql("INSERT INTO vp_part(upload_id,part_no) VALUES(?,?) ON DUPLICATE KEY UPDATE part_no=part_no").params(u.id(),index).update();
    }
    @Transactional(rollbackFor=Exception.class)
    public Map<String,Object> finish(UUID id) throws Exception {
        var u=get(id,true);
        if(!u.complete()) {
            int n=json.readTree(u.hashes()).size();
            if(db.sql("SELECT COUNT(*) FROM vp_part WHERE upload_id=?").param(u.id()).query(Integer.class).single()!=n)
                throw new ResponseStatusException(HttpStatus.CONFLICT,"还有分片未上传");
            store.assemble(u.id(),n,u.storedName(),directory);
            String title=u.filename().substring(0,u.filename().lastIndexOf('.'));
            db.sql("INSERT INTO videos(id,title,duration,status,created_at,owner_id) VALUES(?,?,0,'uploaded',UTC_TIMESTAMP(),?)").params(u.video(),title,visitor.id()).update();
            db.sql("UPDATE vp_upload SET complete=true WHERE id=?").param(u.id()).update();
        }
        return Map.of("success",true,"filepath",u.storedName(),"video_id",u.video());
    }
}
