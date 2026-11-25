package org.videoparse;

import java.util.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/v2/uploads")
class UploadController {
    private final UploadService uploads;
    UploadController(UploadService uploads){this.uploads=uploads;}
    @PostMapping Map<String,Object> create(@RequestBody UploadService.Manifest body) throws Exception {
        return Map.of("success",true,"id",uploads.begin(body));
    }
    @GetMapping("/{id}") Map<String,Object> status(@PathVariable UUID id) {
        return Map.of("success",true,"parts",uploads.parts(id));
    }
    @PutMapping("/{id}/{index}") Map<String,Object> part(@PathVariable UUID id,@PathVariable int index,HttpServletRequest req) throws Exception {
        byte[] bytes=req.getInputStream().readNBytes(UploadService.CHUNK+1);
        if(bytes.length>UploadService.CHUNK) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE);
        uploads.put(id,index,bytes); return Map.of("success",true);
    }
    @PostMapping("/{id}/complete") Map<String,Object> finish(@PathVariable UUID id) throws Exception {return uploads.finish(id);}
}
