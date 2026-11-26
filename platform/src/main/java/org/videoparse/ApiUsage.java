package org.videoparse;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@Service
class ApiUsage {
    private static final Logger log = LoggerFactory.getLogger(ApiUsage.class);
    private final JdbcClient db;
    ApiUsage(JdbcClient db) { this.db = db; }

    // Synchronous provider clients may split one embedding operation into multiple HTTP requests.
    record Context(String owner, String operation) {}
    private static final ThreadLocal<Context> current = new ThreadLocal<>();
    interface Scope extends AutoCloseable { @Override void close(); }
    static Scope scope(String owner, String operation) {
        var previous = current.get();
        current.set(new Context(Objects.requireNonNull(owner), operation));
        return () -> { if (previous == null) current.remove(); else current.set(previous); };
    }

    @Transactional(propagation=Propagation.REQUIRES_NEW)
    public long begin(String url, String model) {
        var ctx = Objects.requireNonNull(current.get(), "API request has no usage owner");
        var key = new GeneratedKeyHolder();
        db.sql("""
            INSERT INTO vp_api_usage(owner_id, started_ms, operation, provider, model, status)
            VALUES (?, ?, ?, ?, ?, 'awaiting')
            """).params(ctx.owner(), System.currentTimeMillis(), ctx.operation(), URI.create(url).getHost(),
                model.substring(0, Math.min(model.length(), 200))).update(key);
        return Objects.requireNonNull(key.getKey()).longValue();
    }

    private static Long count(JsonNode usage, String name) {
        JsonNode n = usage == null ? null : usage.get(name);
        return n != null && n.isIntegralNumber() && n.canConvertToLong() && n.longValue() >= 0 ? n.longValue() : null;
    }

    @Transactional(propagation=Propagation.REQUIRES_NEW)
    public void finish(long id, String status, JsonNode usage) {
        Long in = count(usage,"prompt_tokens"), out = count(usage,"completion_tokens"), total = count(usage,"total_tokens");
        if (total == null && in != null && out != null) total = Math.addExact(in, out);
        String prefix = "failed".equals(status) ? "failed_" : "";
        if (total != null) status = prefix+"reported";
        else if (in != null || out != null) status = prefix+"partial";
        db.sql("UPDATE vp_api_usage SET status=?, input_tokens=?, output_tokens=?, total_tokens=? WHERE id=?")
            .params(status, in, out, total, id).update();
    }

    static void recordResult(ApiUsage ledger, long id, String status, JsonNode usage) {
        try { ledger.finish(id, status, usage); }
        catch (RuntimeException e) { log.error("API 用量回执未能更新，记录 {} 待核对", id); }
    }

    @Transactional(readOnly=true)
    public Map<String,Object> page(String owner, Long before) {
        var summary = db.sql("""
            SELECT COUNT(*) AS requests, COALESCE(SUM(COALESCE(total_tokens,COALESCE(input_tokens,0)+COALESCE(output_tokens,0))),0) AS tokens,
                   COALESCE(SUM(estimated_usd_micros),0) AS estimated_usd_micros,
                   COUNT(CASE WHEN total_tokens IS NULL AND estimated_usd_micros IS NULL THEN 1 END) AS unconfirmed
            FROM vp_api_usage WHERE owner_id=?
            """).param(owner).query().singleRow();
        String sql = """
            SELECT id,started_ms,operation,provider,model,status,input_tokens,output_tokens,total_tokens,estimated_usd_micros
            FROM vp_api_usage WHERE owner_id=?
            """ + (before == null ? "" : " AND id<?") + " ORDER BY id DESC LIMIT 31";
        var query = db.sql(sql).param(owner);
        if (before != null) query = query.param(before);
        var rows = query.query().listOfRows();
        var result = new LinkedHashMap<String,Object>();
        result.put("success",true);
        result.put("summary",summary);
        result.put("items",rows.subList(0,Math.min(30,rows.size())));
        result.put("next",rows.size()>30 ? rows.get(29).get("id") : null);
        return result;
    }
}

@RestController
class UsageController {
    private final Visitor visitor;
    private final ApiUsage usage;
    UsageController(Visitor visitor, ApiUsage usage) { this.visitor=visitor; this.usage=usage; }
    @GetMapping("/v2/usage")
    Map<String,Object> usage(@RequestParam(required=false) Long before) {
        return usage.page(visitor.id(), before);
    }
}
