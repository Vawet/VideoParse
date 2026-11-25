package org.videoparse;

import java.util.Map;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/v2/documents")
class DocumentController {
    private final DocumentLibrary library;
    DocumentController(DocumentLibrary library) { this.library=library; }
    @PostMapping Map<String,Object> upload(@RequestPart("file") MultipartFile file) throws Exception {
        return Map.of("success",true,"document",library.upload(file));
    }
    @GetMapping Map<String,Object> list() { return Map.of("success",true,"documents",library.list()); }
    @GetMapping("/{id}") Map<String,Object> read(@PathVariable String id) {
        return Map.of("success",true,"document",library.require(id),"markdown",library.markdown(id));
    }
    @PostMapping("/{id}/retry") Map<String,Object> retry(@PathVariable String id) {
        return Map.of("success",true,"document",library.retry(id));
    }
}
