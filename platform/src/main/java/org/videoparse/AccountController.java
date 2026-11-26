package org.videoparse;

import jakarta.servlet.http.HttpServletRequest;
import java.security.*;
import java.time.Duration;
import java.util.*;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/v2/account")
class AccountController {
    record Credentials(String username,String password) {}
    record Account(String ownerId,byte[] salt,byte[] passwordHash) {}
    private final JdbcClient db;
    private final Visitor visitor;
    private final TransactionTemplate tx;
    private final StringRedisTemplate redis;
    private static final SecureRandom RANDOM=new SecureRandom();
    private static final DefaultRedisScript<Long> ATTEMPT=new DefaultRedisScript<>("""
        local n=redis.call('INCR',KEYS[1])
        if n==1 then redis.call('EXPIRE',KEYS[1],60) end
        return n
        """,Long.class);
    AccountController(JdbcClient db,Visitor visitor,TransactionTemplate tx,StringRedisTemplate redis) {
        this.db=db; this.visitor=visitor; this.tx=tx; this.redis=redis;
    }

    private String credentials(Credentials c,HttpServletRequest req) {
        String user=Objects.toString(c.username(),"").strip().toLowerCase(Locale.ROOT);
        if (!user.matches("[a-z0-9][a-z0-9._-]{2,63}") || c.password()==null || c.password().length()<8 || c.password().length()>128)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"用户名需为 3–64 位字母、数字或 ._-，密码需为 8–128 个字符");
        if (redis.execute(ATTEMPT,List.of("vp:account:ip:"+req.getRemoteAddr()))>180 ||
                redis.execute(ATTEMPT,List.of("vp:account:user:"+user))>12)
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"尝试过于频繁，请稍后重试");
        return user;
    }

    private byte[] derive(String password,byte[] salt) {
        var spec=new PBEKeySpec(password.toCharArray(),salt,600_000,256);
        try { return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); }
        catch (GeneralSecurityException e) { throw new IllegalStateException(e); }
        finally { spec.clearPassword(); }
    }

    private String session(String owner) {
        String token=Visitor.newToken();
        db.sql("UPDATE vp_visitor SET expires_at=GREATEST(expires_at,UTC_TIMESTAMP()+INTERVAL 30 DAY) WHERE id=?")
            .param(owner).update();
        db.sql("INSERT INTO vp_account_session(token_hash,owner_id,expires_at) VALUES(?,?,UTC_TIMESTAMP()+INTERVAL 30 DAY)")
            .params(Visitor.hash(token),owner).update();
        return token;
    }
    private Map<String,Object> signedIn(String token,String name) {
        visitor.cookie(token,Duration.ofDays(30));
        return Map.of("success",true,"username",name);
    }
    private void revokeCurrent() {
        if (visitor.username()!=null)
            db.sql("DELETE FROM vp_account_session WHERE token_hash=?").param(Visitor.hash(visitor.workerToken())).update();
    }

    @PostMapping("/register")
    Map<String,Object> register(@RequestBody Credentials c,HttpServletRequest req) {
        if (visitor.username()!=null) throw new ResponseStatusException(HttpStatus.CONFLICT,"请先退出当前账号");
        String user=credentials(c,req);
        byte[] salt=new byte[16]; RANDOM.nextBytes(salt);
        byte[] verifier=derive(c.password(),salt);
        try {
            String token=tx.execute(status->{
                String owner=visitor.createAccountOwner();
                db.sql("INSERT INTO vp_account(owner_id,username,salt,password_hash) VALUES(?,?,?,?)")
                    .params(owner,user,salt,verifier).update();
                return session(owner);
            });
            return signedIn(token,user);
        } catch (DuplicateKeyException e) { throw new ResponseStatusException(HttpStatus.CONFLICT,"该用户名已被注册"); }
    }

    @PostMapping("/login")
    Map<String,Object> login(@RequestBody Credentials c,HttpServletRequest req) {
        String user=credentials(c,req);
        var row=db.sql("SELECT owner_id,salt,password_hash FROM vp_account WHERE username=?")
            .param(user).query(Account.class).optional();
        byte[] candidate=derive(c.password(),row.map(Account::salt).orElseGet(()->new byte[16]));
        if (row.isEmpty() || !MessageDigest.isEqual(candidate,row.get().passwordHash()))
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"用户名或密码错误");
        String token=tx.execute(status->{ revokeCurrent(); return session(row.get().ownerId()); });
        return signedIn(token,user);
    }

    @PostMapping("/logout")
    Map<String,Object> logout() {
        revokeCurrent();
        visitor.cookie("",Duration.ZERO);
        return Map.of("success",true);
    }

    @Scheduled(fixedDelay=3600000)
    void expire() {
        db.sql("DELETE FROM vp_account_session WHERE expires_at<=UTC_TIMESTAMP() LIMIT 2000").update();
    }
}
