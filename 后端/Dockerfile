FROM python:3.11-slim

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

# 任务状态保存在进程内存里（app/tasks.py），所以必须单 worker + 多线程；
# timeout 调大，避免同步 /analyze 被杀。
CMD ["sh", "-c", "gunicorn app.main:app -b 0.0.0.0:${PORT} --workers 1 --threads 8 --timeout 1800"]
