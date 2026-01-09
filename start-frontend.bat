@echo off
echo 🚀 启动前端服务...

cd "%~dp0前端\my-react-app"

if not exist "node_modules" (
  echo 📦 首次运行，安装 npm 依赖...
  call npm install
)

echo ▶️  启动 React 开发服务器 (http://localhost:8080)...
call npm start
