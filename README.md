# Video_Parse

## 2025腾讯犀牛鸟开源人才培养计划—视频生成图文混排讲义工具

***

## 🚀 项目概述

### 这是一个基于大模型的视频解析及生成笔记的项目，支持导出图文混排的pdf讲义和思维导图。

***

## 📋 功能特性

### 📺 音视频处理模块（ffmpeg和调用大模型）
- **提取音频audio**: 使用ffmpeg提取视频的audio部分，
- **ASR**:使用whisper-v3-turbo大模型，获取每句话的开始时间和结束时间
- **图片向量化去重**: 使用CLIP_Large大模型,cosine_similarity 用于计算余弦相似度,设置similarity相似度进行去重，从而生成PPT
- **向量化**: 使用SiliconFlow API进行文本向量化，支持批量处理
- **大模型语义切割**: 基于qwen-vl-plus大模型对语义进行分段和摘要总结

### 🧠 解析制作模块（概览、笔记、思维导图）
- **概览生成**: 结合时间戳和分段生成
- **markdown笔记生成**: 生成markdown的图文混排笔记
- **思维导图**: node节点生成自定义样式的思维导图，可导出为canvas
- **pdf版本**:均能导出pdf版本

### 🤖 解析文件管理模块（文件的分类处理）
- **文件管理**: 可对解析卡片拖拽进行文件分类
- **解析内容存储**: 采用本地存储IndexedDB进行存储

***


***

## 🛠️ 安装与配置

### 1. 克隆项目
```bash
git clone https://github.com/Vawet/VideoParse.git
```

### 2. 安装依赖
```bash
pip install -r requirements.txt
```

### 3. 配置环境变量
创建 `.env` 文件：
```env
DASHSCOPE_API_KEY=你的实际API密钥
```
***

## 📖 使用方法


### 运行测试
```bash
# 运行集成测试
python tests/test_video_analysis.py -v
#运行某个测试用例
puthon tests/test_video_analysis.py::test_video_info -v
```
***

## 📁 项目结构

```
VideoParse/
├── app/           # 后端核心源代码
│   ├── actions/   #文档处理模块
│   ├── audio/     # 音频文件
│   ├── frames/    # 视频帧文件
│   ├── outputs/      # 解析输出
│   ├── tests/        # 测试
│   └── uploads/      #上传的mp4文件
├── .env              # 环境变量
├── main.py           # 主程序
├── requirements.txt  # 依赖列表
└── README.md         # 项目说明
```

***



## 个人项目
***

## 📝 开发说明

### Git提交步骤
1. 拉取最新代码: `git pull origin main`
2. 开发完成后: `git status`
3. 添加所有修改: `git add .`
4. 提交: `git commit -m "评论"`
5. 再次拉取: `git pull origin main`
6. 推送: `git push origin main`

***

## 📄 许可证

本项目为2025腾讯犀牛鸟开源人才培养计划项目。

***

## 🤝 贡献

欢迎提交Issue和Pull Request！

---

**最后更新**: 2025-09-09
**版本**: v1.0.0
