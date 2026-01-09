#!/bin/bash

echo "🚀 启动前端服务..."

cd "$(dirname "$0")/前端/my-react-app"

if [ ! -d "node_modules" ]; then
  echo "📦 首次运行，安装 npm 依赖..."
  npm install
fi

echo "▶️  启动 React 开发服务器 (http://localhost:8080)..."
npm start
