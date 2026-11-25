package org.videoparse;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.HexFormat;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.annotation.RequestScope;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
@RequestScope
class Visitor {
    static final String COOKIE = "vp_session";
    private static final SecureRandom RANDOM = new SecureRandom();
    private final JdbcClient db;
    private final HttpServletResponse response;
    private final boolean secure;
    private String id, token, username;
    record Identity(String id,String username) {}

    Visitor(JdbcClient db, HttpServletRequest request, HttpServletResponse response,
            @Value("${SESSION_COOKIE_SECURE:true}") boolean secure) {
        this.db = db;
        this.response = response;
        this.secure = secure;
        response.setHeader(HttpHeaders.CACHE_CONTROL,"private, no-store");
        var cookies = request.getCookies();
        if (cookies != null) for (var cookie : cookies) {
            if (!COOKIE.equals(cookie.getName()) || !cookie.getValue().matches("[0-9a-f]{64}")) continue;
            String presented = cookie.getValue();
            byte[] digest=hash(presented);
            var existing = db.sql("""
                SELECT v.id,NULL AS username FROM vp_visitor v WHERE v.token_hash=? AND v.expires_at>UTC_TIMESTAMP()
                    AND NOT EXISTS (SELECT 1 FROM vp_account a WHERE a.owner_id=v.id)
                UNION ALL
                SELECT s.owner_id AS id,a.username FROM vp_account_session s JOIN vp_account a ON a.owner_id=s.owner_id
                WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP()
                """).params(digest,digest).query(Identity.class).optional();
            if (existing.isPresent()) {
                token = presented;
                id = existing.get().id();
                username = existing.get().username();
                return;
            }
        }
    }

    String start() {
        if (id != null) return id;
        token = newToken();
        id = UUID.randomUUID().toString().replace("-","");
        db.sql("INSERT INTO vp_visitor(id,token_hash,expires_at) VALUES(?,?,UTC_TIMESTAMP()+INTERVAL 365 DAY)")
            .params(id,hash(token)).update();
        cookie(token,Duration.ofDays(365));
        return id;
    }

    static String newToken() {
        byte[] bytes=new byte[32];
        RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
    String username() { return username; }
    void cookie(String value,Duration duration) {
        var cookie = ResponseCookie.from(COOKIE,value).httpOnly(true).secure(secure).sameSite("Strict")
            .path("/").maxAge(duration).build();
        response.addHeader(HttpHeaders.SET_COOKIE,cookie.toString());
    }

    static byte[] hash(String value) {
        try { return MessageDigest.getInstance("SHA-256").digest(HexFormat.of().parseHex(value)); }
        catch (NoSuchAlgorithmException ex) { throw new IllegalStateException(ex); }
    }

    String id() {
        if (id == null) throw missing();
        return id;
    }
    String workerToken() { return token; }

    void video(String video) {
        if (video == null || !video.matches("[A-Za-z0-9_-]{1,64}")) throw missing();
        require(db.sql("SELECT 1 FROM videos WHERE id=? AND owner_id=?").params(video,id()));
    }
    void course(String course) {
        require(db.sql("""
            SELECT 1 FROM courses c WHERE c.id=? AND c.owner_id=?
              AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.course_id=c.id AND NOT (v.owner_id <=> c.owner_id))
            """).params(course,id()));
    }
    void quiz(String quiz) {
        require(db.sql("""
            SELECT 1 FROM quizzes q LEFT JOIN videos v ON v.id=q.video_id LEFT JOIN courses c ON c.id=q.course_id
            WHERE q.id=? AND (v.owner_id=? OR c.owner_id=?)
              AND (q.video_id IS NULL OR v.owner_id=?) AND (q.course_id IS NULL OR c.owner_id=?)
            """).params(quiz,id(),id,id,id));
    }
    void plan(String plan) {
        require(db.sql("SELECT 1 FROM teach_plans p JOIN courses c ON c.id=p.course_id WHERE p.id=? AND c.owner_id=?").params(plan,id()));
    }
    private void require(JdbcClient.StatementSpec query) {
        if (query.query(Integer.class).optional().isEmpty()) throw missing();
    }
    private static ResponseStatusException missing() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND,"资源不存在");
    }
}

@RestController
class SessionController {
    private final Visitor visitor;
    SessionController(Visitor visitor) { this.visitor = visitor; }
    @GetMapping("/v2/session") java.util.Map<String,Object> session() {
        return java.util.Map.of("success",true,"workspace_id",visitor.start(),
            "username",java.util.Objects.toString(visitor.username(),""));
    }
}
