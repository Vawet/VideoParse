FROM python:3.11-slim AS media

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-chi-sim \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# CPU 版 torch 体积小得多；先装它，requirements 里的 torch 就不会再拉 CUDA 版
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY app/requirements.txt app/requirements.txt
RUN pip install --no-cache-dir -r app/requirements.txt gunicorn

COPY app app

# 产物目录挂持久卷到 /data
ENV DATA_ROOT=/data PORT=5000
VOLUME /data

FROM maven:3.9-eclipse-temurin-21 AS java-build
WORKDIR /build
COPY --from=platform_src /pom.xml .
COPY --from=platform_src /src src
RUN mvn -B -Dmaven.test.skip=true package

FROM eclipse-temurin:21-jre AS jre
FROM media AS platform
COPY --from=jre /opt/java/openjdk /opt/java/openjdk
COPY --from=java-build /build/target/platform-1.0.0.jar /srv/platform.jar
CMD ["/opt/java/openjdk/bin/java","-jar","/srv/platform.jar"]

FROM media AS legacy
# 任务状态保存在进程内存里（app/tasks.py），所以必须单 worker + 多线程；
# timeout 调大，避免同步 /analyze 被杀。
CMD ["sh", "-c", "gunicorn app.main:app -b 127.0.0.1:${PORT} --workers 1 --threads 8 --timeout 1800"]
