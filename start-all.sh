#!/bin/bash

echo "🚀 启动视频AI解读项目..."
echo ""

# 获取脚本所在目录
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 启动后端（后台运行）
echo "📡 启动后端服务..."
cd "$PROJECT_DIR/后端"
pip install -r app/requirements.txt > /dev/null 2>&1
python -m app.main &
BACKEND_PID=$!
echo "✅ 后端已启动 (PID: $BACKEND_PID) - http://localhost:5000"

# 等待后端启动
sleep 3

# 启动前端
echo ""
echo "🌐 启动前端服务..."
cd "$PROJECT_DIR/前端/my-react-app"

if [ ! -d "node_modules" ]; then
  echo "📦 安装前端依赖..."
  npm install
fi

echo "✅ 前端启动中 - http://localhost:8080"
npm start

# 当前端退出时，也停止后端
echo ""
echo "🛑 停止后端服务..."
kill $BACKEND_PID
