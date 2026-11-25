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
    record Media(String name, double duration, String filename) {}
    private final JdbcClient db;
    private final Visitor visitor;
    private final DocumentLibrary documents;
    private final AnalysisResults results;
    private final Path uploads;

    LibraryController(JdbcClient db, Visitor visitor, DocumentLibrary documents, AnalysisResults results,
                      @Value("${videoparse.data}") Path root) {
        this.db = db;
        this.visitor = visitor;
        this.documents = documents;
        this.results = results;
        this.uploads = root.resolve("uploads");
    }

    @GetMapping
    @Transactional(readOnly = true)
    public Map<String,Object> library() {
        String owner = visitor.id();
        var folders = db.sql("SELECT id,name FROM vp_library_folder ORDER BY id DESC").query(Folder.class).list();
        var videos = db.sql("""
            SELECT id,title AS name,duration FROM videos WHERE owner_id=? AND folder_id='videos'
            ORDER BY created_at DESC,id
            """).param(owner).query(Video.class).list();
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
