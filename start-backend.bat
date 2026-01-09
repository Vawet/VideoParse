@echo off
echo 🚀 启动后端服务...

cd "%~dp0后端"

echo 📦 安装 Python 依赖...
pip install -r app/requirements.txt

echo ▶️  启动 Flask 服务 (http://localhost:5000)...
python -m app.main
