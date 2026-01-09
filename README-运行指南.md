# 🚀 视频AI解读项目 - 运行指南

## 快速启动

### 方式一：一键启动（推荐）

**Linux / macOS:**
```bash
./start-all.sh
```

**Windows:**
```bash
# 需要分别打开两个终端窗口
start-backend.bat  # 终端1
start-frontend.bat # 终端2
```

### 方式二：分别启动

**启动后端：**

Linux/macOS: `./start-backend.sh`
Windows: `start-backend.bat`

**启动前端：**

Linux/macOS: `./start-frontend.sh`
Windows: `start-frontend.bat`

---

## 手动运行命令

如果脚本无法执行，可以手动运行以下命令：

### 后端
```bash
cd 后端
pip install -r app/requirements.txt
python -m app.main
```

### 前端
```bash
cd 前端/my-react-app
npm install
npm start
```

---

## 访问地址

- **后端 API:** http://localhost:5000
- **前端页面:** http://localhost:8080

---

## 环境要求

- Python 3.8+
- Node.js 14+
- ffmpeg（需安装到系统 PATH）
- DASHSCOPE_API_KEY（在 `.env` 文件中配置）

---

## 常见问题

**Q: 提示权限不足？**
A: 运行 `chmod +x start-*.sh`

**Q: 后端启动失败？**
A: 检查是否配置了 `.env` 文件中的 API 密钥

**Q: 前端无法访问后端？**
A: 确保后端已启动在 5000 端口
