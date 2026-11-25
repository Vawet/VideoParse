FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY platform/pom.xml .
COPY platform/src src
RUN mvn -B -Dmaven.test.skip=true package

FROM eclipse-temurin:21-jre AS jre
FROM media_runtime
COPY --from=jre /opt/java/openjdk /opt/java/openjdk
COPY --from=build /build/target/platform-1.0.0.jar /srv/platform.jar
CMD ["/opt/java/openjdk/bin/java","-jar","/srv/platform.jar"]
