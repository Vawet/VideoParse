"""全局配置：路径、模型名、千问客户端（懒加载，避免 import 时因缺 key 崩溃）。"""
import os
import logging
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
FRAMES_FOLDER = os.path.join(BASE_DIR, "frames")
AUDIO_FOLDER = os.path.join(BASE_DIR, "audio")
OUTPUT_FOLDER = os.path.join(BASE_DIR, "outputs")
ALLOWED_EXTENSIONS = {"mp4", "mov", "avi", "mkv", "flv"}
MAX_CONTENT_LENGTH = 100 * 1024 * 1024

DATA_FOLDER = os.path.join(BASE_DIR, "data")
# 数据库：开发/测试默认 SQLite；正式部署设置 DATABASE_URL=postgresql+psycopg://user:pass@host/db
DATABASE_URL = os.getenv("DATABASE_URL") or f"sqlite:///{os.path.join(DATA_FOLDER, 'videoparse.db')}"

for _folder in (UPLOAD_FOLDER, FRAMES_FOLDER, AUDIO_FOLDER, OUTPUT_FOLDER, DATA_FOLDER):
    os.makedirs(_folder, exist_ok=True)



def _ensure_ffmpeg():
    """系统没有 ffmpeg 时，用 imageio_ffmpeg 自带的二进制兜底（Whisper 与 media 都按名字调用 ffmpeg）。"""
    import shutil
    if shutil.which("ffmpeg"):
        return
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        shim = os.path.join(DATA_FOLDER, "bin")
        os.makedirs(shim, exist_ok=True)
        link = os.path.join(shim, "ffmpeg")
        if not os.path.exists(link):
            os.symlink(exe, link)
        os.environ["PATH"] = shim + os.pathsep + os.environ.get("PATH", "")
        logging.getLogger(__name__).info("使用内置 ffmpeg: %s", exe)
    except Exception as e:  # noqa: BLE001
        logging.getLogger(__name__).warning("未找到 ffmpeg，音视频处理将不可用: %s", e)


_ensure_ffmpeg()

# ---------------------------------------------------------------- 大模型供应商
# LLM_PROVIDER=dashscope(阿里云千问) | deepseek；不设置时：只配了 DEEPSEEK_API_KEY 就用 deepseek，否则用 dashscope
PROVIDERS = {
    "dashscope": {
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "key_env": "DASHSCOPE_API_KEY",
        "agent": "qwen-plus", "text": "qwen-plus", "vision": "qwen-vl-plus",
        "extra_body": {},
    },
    "deepseek": {
        "base_url": "https://api.deepseek.com",
        "key_env": "DEEPSEEK_API_KEY",
        # deepseek-flash 同时支持 Tool Calls 与图像理解，一个模型覆盖全部场景
        "agent": "deepseek-flash", "text": "deepseek-flash", "vision": "deepseek-flash",
        # 关闭思考模式：Agent 多轮工具调用无需回传 reasoning_content，也更快更省
        "extra_body": {"thinking": {"type": "disabled"}},
    },
}


def _detect_provider():
    name = os.getenv("LLM_PROVIDER", "").strip().lower()
    if name in PROVIDERS:
        return name
    if os.getenv("DEEPSEEK_API_KEY") and not os.getenv("DASHSCOPE_API_KEY"):
        return "deepseek"
    return "dashscope"


PROVIDER = _detect_provider()
_P = PROVIDERS[PROVIDER]
LLM_BASE_URL = os.getenv("LLM_BASE_URL", _P["base_url"])
AGENT_MODEL = os.getenv("AGENT_MODEL", _P["agent"])    # Agent 决策（需支持 function calling）
TEXT_MODEL = os.getenv("TEXT_MODEL", _P["text"])       # 文本任务
VISION_MODEL = os.getenv("VISION_MODEL", _P["vision"]) # 看图（需支持图像理解）
AGENT_MAX_STEPS = int(os.getenv("AGENT_MAX_STEPS", "25"))
# 解析模式：pipeline(默认，确定性流水线 + 异常时 Agent 兜底) | agent(全程由 Agent 自主规划)
ANALYZE_MODE = os.getenv("ANALYZE_MODE", "pipeline")
DEFAULT_PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:5000")

_client = None


def extra_body():
    """供应商特有的请求参数（例如 DeepSeek 关闭思考模式）。"""
    return dict(_P["extra_body"])


def get_client():
    """懒加载 OpenAI 兼容客户端。"""
    global _client
    if _client is None:
        from openai import OpenAI
        key = os.getenv("LLM_API_KEY") or os.getenv(_P["key_env"])
        if not key:
            raise EnvironmentError(f"{_P['key_env']} 环境变量未配置（当前供应商: {PROVIDER}）")
        _client = OpenAI(api_key=key, base_url=LLM_BASE_URL)
    return _client


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
