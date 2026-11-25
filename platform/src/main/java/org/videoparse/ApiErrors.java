package org.videoparse;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice
class ApiErrors {
    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<?> status(ResponseStatusException e){
        return ResponseEntity.status(e.getStatusCode()).body(Map.of("success",false,"error", e.getReason()==null?"请求失败":e.getReason()));
    }
}
