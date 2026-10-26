#!/bin/bash

echo "🚀 启动后端服务..."

cd "$(dirname "$0")/后端"
[ -f ".venv/bin/activate" ] && source .venv/bin/activate  # 优先使用后端虚拟环境(含 ffmpeg)

echo "📦 安装 Python 依赖..."
pip install -r app/requirements.txt

echo "▶️  启动 Flask 服务 (http://localhost:5000)..."
python -m app.main
