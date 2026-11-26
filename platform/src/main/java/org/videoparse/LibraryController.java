package org.videoparse;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/v2/library")
class LibraryController {
    record Folder(String id, String name) {}
    record Video(String id, String name, double duration) {}
    record VideoEntry(String id,String name,double duration,String indexState) {}
    record Media(String name, double duration, String filename) {}
    private final JdbcClient db;
    private final Visitor visitor;
    private final DocumentLibrary documents;
    private final AnalysisResults results;
    private final LibrarySearch search;
    private final Path uploads;

    LibraryController(JdbcClient db, Visitor visitor, DocumentLibrary documents, AnalysisResults results,LibrarySearch search,
                      @Value("${videoparse.data}") Path root) {
        this.db = db;
        this.visitor = visitor;
        this.documents = documents;
        this.results = results;
        this.search = search;
        this.uploads = root.resolve("uploads");
    }

    @GetMapping
    @Transactional(readOnly = true)
    public Map<String,Object> library() {
        String owner = visitor.id();
        var folders = db.sql("SELECT id,name FROM vp_library_folder ORDER BY id DESC").query(Folder.class).list();
        var videos = db.sql("""
            SELECT id,title AS name,duration,library_state AS index_state FROM videos WHERE owner_id=? AND folder_id='videos'
            ORDER BY created_at DESC,id
            """).param(owner).query(VideoEntry.class).list();
        return Map.of("success",true,"folders",folders,"videos",videos,"documents",documents.list());
    }

    @GetMapping("/videos/{id}")
    Map<String,Object> openVideo(@PathVariable String id) throws IOException {
        if (!id.matches("[a-zA-Z0-9_-]{1,64}")) throw missing();
        var video = db.sql("""
            SELECT v.title AS name,v.duration,u.filename FROM videos v
            LEFT JOIN vp_upload u ON u.video=v.id AND u.owner_id=v.owner_id AND u.complete
            WHERE v.owner_id=? AND v.folder_id='videos' AND v.id=?
            """).params(visitor.id(),id).query(Media.class).optional().orElseThrow(LibraryController::missing);
        var result = results.result(id);
        if (result == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"归档视频的解析结果文件不存在");
        String filepath = mediaFile(id, video.filename());
        return Map.of("success",true,"video",new Video(id,video.name(),video.duration()),"filepath",filepath,"result",result);
    }

    @GetMapping("/videos/{id}/passages/{key}")
    @Transactional(readOnly=true)
    public Map<String,Object> passage(@PathVariable String id,@PathVariable String key) {
        var hit=search.requireHit(visitor.id(),id,key);
        var filename=db.sql("SELECT filename FROM vp_upload WHERE video=? AND owner_id=? AND complete LIMIT 1")
                .params(id,visitor.id()).query(String.class).optional().orElse(null);
        return Map.of("success",true,"hit",hit,"filepath",mediaFile(id,filename));
    }

    @PostMapping("/videos/{id}/retry")
    Map<String,Object> retry(@PathVariable String id) {
        search.requireVideo(visitor.id(),id);
        db.sql("""
            UPDATE videos SET library_state='pending',library_attempts=0,library_after=CURRENT_TIMESTAMP(3)
            WHERE id=? AND owner_id=? AND folder_id='videos' AND library_state IN ('error','empty')
            """).params(id,visitor.id()).update();
        return Map.of("success",true);
    }

    @PatchMapping("/videos/{id}")
    @Transactional
    public Map<String,Object> rename(@PathVariable String id,@RequestBody Map<String,String> body) {
        String name=body.getOrDefault("name","");
        if (name==null || name.isBlank() || name.length()>300 || name.chars().anyMatch(Character::isISOControl))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"视频名称需要 1 至 300 字");
        String owner=visitor.id();
        if (db.sql("SELECT 1 FROM videos WHERE id=? AND owner_id=? AND folder_id='videos' FOR UPDATE")
                .params(id,owner).query(Integer.class).optional().isEmpty()) throw missing();
        db.sql("UPDATE videos SET title=? WHERE id=? AND owner_id=?").params(name.strip(),id,owner).update();
        return Map.of("success",true);
    }

    @DeleteMapping("/videos/{id}")
    @Transactional
    public Map<String,Object> remove(@PathVariable String id) {
        if (db.sql("UPDATE videos SET folder_id=NULL WHERE id=? AND owner_id=? AND folder_id='videos'")
                .params(id,visitor.id()).update()==0) throw missing();
        db.sql("DELETE FROM vp_video_passage WHERE video_id=?").param(id).update();
        return Map.of("success",true);
    }

    private String mediaFile(String id, String filename) {
        // Imported analyses can predate resumable upload manifests.
        var extensions = List.of("mp4","webm","mkv","mov","avi","flv","m4v");
        if (filename != null && filename.contains(".")) {
            String ext = filename.substring(filename.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);
            if (extensions.contains(ext) && Files.isRegularFile(uploads.resolve(id+"."+ext), LinkOption.NOFOLLOW_LINKS))
                return id+"."+ext;
        }
        for (String ext : extensions)
            if (Files.isRegularFile(uploads.resolve(id+"."+ext), LinkOption.NOFOLLOW_LINKS)) return id+"."+ext;
        return "";
    }

    private static ResponseStatusException missing() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND,"归档视频不存在");
    }
}
