package org.videoparse;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class Platform {
    public static void main(String[] args) {
        SpringApplication.run(Platform.class, args);
    }
}
