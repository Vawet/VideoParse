package org.videoparse;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@RestController
class MediaController {
    private final Visitor visitor;
    private final Path root;
    private final UploadService uploads;
    private final UploadGate gate;
    MediaController(@Value("${videoparse.data}") Path root,UploadService uploads,UploadGate gate,Visitor visitor){
        this.visitor=visitor;this.root=root;this.uploads=uploads;this.gate=gate;
    }
    @GetMapping("/upload/question") Map<String,Object> question(){return gate.question();}
    @PostMapping("/upload/verify") Map<String,Object> verify(@RequestBody Map<String,String> body,HttpServletRequest req){return gate.verify(body,req);}
    @PostMapping("/upload") Map<String,Object> upload(@RequestPart("video") MultipartFile file,@RequestParam(defaultValue="") String token) throws Exception {
        if(file.isEmpty() || file.getSize()>100L*1024*1024) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"单次上传上限为 100 MiB");
        var hashes=new ArrayList<String>();
        try(var in=file.getInputStream()) {
            for(byte[] part;(part=in.readNBytes(UploadService.CHUNK)).length!=0;)
                hashes.add(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(part)));
        }
        var id=UUID.fromString(uploads.begin(new UploadService.Manifest(file.getOriginalFilename(),file.getSize(),hashes,token)));
        try(var in=file.getInputStream()) {
            int i=0;
            for(byte[] part;(part=in.readNBytes(UploadService.CHUNK)).length!=0;) uploads.put(id,i++,part);
        }
        return uploads.finish(id);
    }
    private static void valid(String id){if(!id.matches("[a-zA-Z0-9_-]{1,64}"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"视频编号无效");}
    private ResponseEntity<Resource> resource(Path file,MediaType type) {
        if(!Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS)) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"文件不存在");
        return ResponseEntity.ok().contentType(type).body(new FileSystemResource(file));
    }
    @GetMapping("/uploads/{filename}") ResponseEntity<Resource> video(@PathVariable String filename){
        if(!filename.matches("[a-zA-Z0-9_-]{1,64}\\.(?i:mp4|mov|avi|mkv|flv|webm|m4v)")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        visitor.video(filename.substring(0,filename.lastIndexOf('.')));
        return resource(root.resolve("uploads").resolve(filename),MediaTypeFactory.getMediaType(filename).orElse(MediaType.APPLICATION_OCTET_STREAM));
    }
    @GetMapping("/frames/{id}/{filename}") ResponseEntity<Resource> image(@PathVariable String id,@PathVariable String filename){
        valid(id);visitor.video(id);
        if(!filename.matches("[a-zA-Z0-9_-]+\\.png"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"只支持 PNG 帧");
        return resource(root.resolve("frames").resolve(id).resolve(filename),MediaType.IMAGE_PNG);
    }
    @GetMapping("/frames/{id}") Map<String,Object> frames(@PathVariable String id) throws Exception {
        valid(id);visitor.video(id);var dir=root.resolve("frames").resolve(id);
        var ppt=new ArrayList<String>();var heavy=new ArrayList<String>();
        if(Files.isDirectory(dir))try(var paths=Files.list(dir)){
            for(String file:paths.filter(Files::isRegularFile).map(p->p.getFileName().toString()).sorted().toList())
                if(file.endsWith(".png") && !file.startsWith("cap_")) (file.startsWith("heavy")?heavy:ppt).add("/frames/"+id+"/"+file);
        }
        return Map.of("success",true,"ppt",ppt,"heavy",heavy);
    }
}
