package org.videoparse;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.*;
import dev.langchain4j.exception.HttpException;
import dev.langchain4j.http.client.*;
import dev.langchain4j.http.client.sse.*;
import java.time.Duration;

/** Intercept the provider response before model validation or SDK batch aggregation. */
final class UsageHttpClient implements HttpClientBuilder {
    private final HttpClientBuilder delegate = HttpClientBuilderLoader.loadHttpClientBuilder();
    private final ApiUsage ledger;
    private final ObjectMapper json;
    private final String model;
    UsageHttpClient(ApiUsage ledger, ObjectMapper json, String model) {
        this.ledger=ledger; this.json=json; this.model=model;
    }
    public Duration connectTimeout() { return delegate.connectTimeout(); }
    public Duration readTimeout() { return delegate.readTimeout(); }
    public HttpClientBuilder connectTimeout(Duration value) { delegate.connectTimeout(value); return this; }
    public HttpClientBuilder readTimeout(Duration value) { delegate.readTimeout(value); return this; }
    private JsonNode reportedUsage(String body) {
        if (body == null) return null;
        try {
            var payload = json.readTree(body);
            return payload == null ? null : payload.get("usage");
        } catch (JsonProcessingException ignored) {
            return null;
        }
    }
    public HttpClient build() {
        var client = delegate.build();
        return new HttpClient() {
            public SuccessfulHttpResponse execute(HttpRequest request) {
                long id = ledger.begin(request.url(), model);
                SuccessfulHttpResponse response;
                try { response = client.execute(request); }
                catch (HttpException e) {
                    ApiUsage.recordResult(ledger,id,"failed",reportedUsage(e.getMessage()));
                    throw e;
                } catch (RuntimeException e) {
                    ApiUsage.recordResult(ledger,id,"failed",null);
                    throw e;
                }
                ApiUsage.recordResult(ledger,id,"unreported",reportedUsage(response.body()));
                return response;
            }
            public void execute(HttpRequest req, ServerSentEventParser parser, ServerSentEventListener listener) {
                throw new UnsupportedOperationException("平台模型当前仅使用完整响应");
            }
        };
    }
}
