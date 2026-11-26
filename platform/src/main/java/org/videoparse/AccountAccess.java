package org.videoparse;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Public playback uses bundled assets. All platform media and study routes require an account. */
@Configuration
class AccountAccess implements WebMvcConfigurer {
    private final Visitor visitor;

    AccountAccess(Visitor visitor) {
        this.visitor = visitor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override
            public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
                visitor.id();
                return true;
            }
        }).excludePathPatterns("/health", "/v2/session", "/v2/account/register", "/v2/account/login", "/error");
    }
}
