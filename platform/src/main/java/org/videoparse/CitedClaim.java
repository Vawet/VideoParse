package org.videoparse;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.function.IntFunction;

record CitedClaim(int id, String answer, String quote, int offset) {
    static List<CitedClaim> verify(JsonNode items, IntFunction<String> excerptById, int limit) {
        if (items == null || !items.isArray()) return List.of();
        var claims = new ArrayList<CitedClaim>();
        for (var item : items) {
            var id = item.path("id");
            var answer = item.path("answer");
            var quoted = item.path("quote");
            if (!id.isIntegralNumber() || !id.canConvertToInt() || !answer.isTextual()
                || answer.textValue().isBlank() || !quoted.isTextual()) continue;
            String literal = quoted.textValue();
            String quote = literal.strip();
            if (quote.codePointCount(0, quote.length()) < 4) continue;
            String excerpt = excerptById.apply(id.intValue());
            if (excerpt == null) continue;
            int offset = excerpt.indexOf(literal);
            if (offset < 0) continue;
            claims.add(new CitedClaim(id.intValue(), answer.textValue().strip(), quote, offset + literal.indexOf(quote)));
            if (claims.size() == limit) break;
        }
        return claims;
    }
}
