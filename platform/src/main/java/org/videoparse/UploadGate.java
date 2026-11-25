package org.videoparse;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/v2/gate")
class UploadGate {
    private final StringRedisTemplate redis;
    private final String question,answer;
    UploadGate(StringRedisTemplate redis,@Value("${UPLOAD_QUESTION:请输入上传口令}") String question,
               @Value("${UPLOAD_ANSWER}") String answer) {
        this.redis=redis; this.question=question; this.answer=answer.strip();
    }
    @GetMapping Map<String,Object> question() {
        return Map.of("success",true,"required",!answer.isEmpty(),"question",question);
    }
    private static final DefaultRedisScript<Long> CHECK = new DefaultRedisScript<>("""
        local n = tonumber(redis.call('GET',KEYS[1]) or '0')
        if n >= 5 then return -1 end
        if ARGV[1] == 'yes' then redis.call('DEL',KEYS[1]); return 1 end
        if redis.call('INCR',KEYS[1]) == 1 then redis.call('EXPIRE',KEYS[1],600) end
        return 0
        """,Long.class);
    @PostMapping Map<String,Object> verify(@RequestBody Map<String,String> body,HttpServletRequest req) {
        if(answer.isEmpty()) return Map.of("success",true,"token","disabled");
        boolean match=MessageDigest.isEqual(answer.getBytes(StandardCharsets.UTF_8),
                    body.getOrDefault("answer","").strip().getBytes(StandardCharsets.UTF_8));
        Long check=redis.execute(CHECK,List.of("vp:attempt:"+req.getRemoteAddr()),match?"yes":"no");
        if(!Objects.equals(check,1L))
            throw new ResponseStatusException(Objects.equals(check,-1L)?HttpStatus.TOO_MANY_REQUESTS:HttpStatus.FORBIDDEN,"上传口令错误或验证次数过多");
        String token=UUID.randomUUID().toString();
        redis.opsForValue().set("vp:grant:"+token,"1",Duration.ofMinutes(10));
        return Map.of("success",true,"token",token);
    }
    void check(String token) {
        if (!answer.isEmpty() && (token == null || !Boolean.TRUE.equals(redis.hasKey("vp:grant:"+token))))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,"请重新验证上传口令");
    }
    void consume(String token) {
        if(!answer.isEmpty() && (token==null || redis.opsForValue().getAndDelete("vp:grant:"+token)==null))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,"请重新验证上传口令");
    }
}
