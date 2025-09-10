import os
import glob
import base64
import time
import uuid
import json
import torch
import whisper
# from whisper.utils import get_writer
import subprocess
from datetime import timedelta
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from tqdm import tqdm
from openai import OpenAI
# 导入处理图片相似度的函数！
from app.actions.generate_ppt import generate_ppt
# 为了多函数同时运行实现的
import threading
from concurrent.futures import ThreadPoolExecutor  # 更简洁的线程池API
import re  # 导入正则表达式模块
from dotenv import load_dotenv
load_dotenv()  # 加载环境变量
# 初始化Flask应用
app = Flask(__name__)
CORS(app)  # 解决跨域问题

# 配置 - 使用绝对路径避免相对路径问题
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
FRAMES_FOLDER = os.path.join(BASE_DIR, 'frames')
AUDIO_FOLDER = os.path.join(BASE_DIR, 'audio')
OUTPUT_FOLDER = os.path.join(BASE_DIR, 'outputs')
ALLOWED_EXTENSIONS = {'mp4', 'mov', 'avi', 'mkv', 'flv'}

# 创建必要的文件夹
for folder in [UPLOAD_FOLDER, FRAMES_FOLDER, AUDIO_FOLDER, OUTPUT_FOLDER]:
    if not os.path.exists(folder):
        os.makedirs(folder, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['FRAMES_FOLDER'] = FRAMES_FOLDER
app.config['AUDIO_FOLDER'] = AUDIO_FOLDER
app.config['OUTPUT_FOLDER'] = OUTPUT_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 限制上传文件大小为100MB


# 阿里云千问模型配置
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY")
if not DASHSCOPE_API_KEY:
    app.logger.error("未找到 DASHSCOPE_API_KEY 环境变量，请先配置")
    raise EnvironmentError("DASHSCOPE_API_KEY 环境变量未配置")

# 创建OpenAI客户端（兼容阿里云千问）
client = OpenAI(
    api_key=DASHSCOPE_API_KEY,
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)


def allowed_file(filename):
    """检查文件是否为允许的视频格式"""
    return '.' in filename and \
        filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_video_duration(video_path):
    """获取视频时长（秒）"""
    try:
        result = subprocess.run(
            ["ffmpeg", "-i", video_path, "-vstats", "-"],
            capture_output=True,
            text=True,
        encoding = 'utf-8'  # 显式指定编码为 UTF-8
        )

        for line in result.stderr.split('\n'):
            if 'Duration' in line:
                duration_str = line.split(',')[0].split('Duration: ')[1].strip()
                h, m, s = duration_str.split(':')
                return int(h) * 3600 + int(m) * 60 + float(s)
        return 0
    except Exception as e:
        app.logger.error(f"获取视频时长失败: {str(e)}")
        return 0


def extract_audio_from_video(video_path, video_id):
    """从视频中提取音频（用于语音识别）"""
    app.logger.info("开始从视频中提取音频...")

    audio_dir = os.path.join(app.config['AUDIO_FOLDER'], video_id)
    os.makedirs(audio_dir, exist_ok=True)
    audio_path = os.path.join(audio_dir, "audio.wav")

    # 使用ffmpeg提取16000Hz单声道WAV音频（百度AI推荐格式）
    cmd = [
        'ffmpeg', '-i', video_path, '-vn', '-acodec', 'pcm_s16le',
        '-ar', '16000', '-ac', '1', '-y',  # -y自动覆盖文件
        audio_path
    ]

    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True,
    encoding='utf-8'  # 显式指定编码为 UTF-8
         )
        app.logger.info(f"音频提取完成: {audio_path}")
        return audio_path
    except subprocess.CalledProcessError as e:
        app.logger.error(f"音频提取失败: {e.stderr}")
        return None
    except FileNotFoundError:
        app.logger.error("未找到ffmpeg，请确保ffmpeg已安装并添加到系统PATH")
        return None


def speech_to_text(audio_path):
    """使用Whisper将音频转换为带时间戳的文字"""
    app.logger.info(f"开始语音转文字（Whisper），音频路径: {audio_path}")

    # 检查文件是否存在
    if not os.path.exists(audio_path):
        app.logger.error(f"音频文件不存在: {audio_path}")
        return []

    # 检查文件大小
    file_size = os.path.getsize(audio_path)
    app.logger.info(f"音频文件大小: {file_size / 1024 / 1024:.2f} MB")

    try:
        # 加载Whisper模型（根据需求选择模型大小，tiny/base/small/medium/large）
        # 模型会自动下载到 ~/.cache/whisper
        # 使用的是ModelScope上下载的whisper-large-v3-turbo模型！
        model_size = "turbo"
        app.logger.info(f"加载Whisper模型: {model_size}")

        # 自动选择设备（优先GPU，没有则用CPU）
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = whisper.load_model(model_size, device=device)

        # 语音识别（带时间戳）
        app.logger.info("开始Whisper语音识别...")
        # 参数说明：
        # - language: 可选，指定语言（如"zh"），不指定则自动检测
        # - word_timestamps: 若为True，会返回每个单词的时间戳（更精细）
        result = model.transcribe(
            audio_path,
            language="zh",  # 针对中文优化，可移除让模型自动检测
            temperature=0.3,
            word_timestamps=False  # 设为True可获取单词级时间戳
        )

        # 打印原始结果（调试用）
        app.logger.info(f"Whisper识别完成，原始结果: {json.dumps(result, ensure_ascii=False, indent=2)}")

        # 提取带时间戳的片段（段落级）
        segments = []
        for segment in result.get("segments", []):
            segments.append({
                "start_time": segment["start"],  # 开始时间（秒）
                "end_time": segment["end"],  # 结束时间（秒）
                "text": segment["text"].strip()  # 识别文本
            })
        text = result.get("text", "")  # 使用get方法，如果text不存在则返回空字符串
        app.logger.info(f"语音转文字完成，共识别到 {len(segments)} 个片段")
        return segments,text

    except Exception as e:
        app.logger.error(f"Whisper语音识别失败: {str(e)}", exc_info=True)
        return []

def correct_text(text,segments):
    """根据PPT内容纠正字幕文本中的标点符号和中英文识别错误"""
    try:
        # 构建消息内容，确保包含"json"字样
        messages = [
            {
                "role": "system",
                "content": """你是一个专业的字幕文案理解纠错员，请纠正字幕文本中的标点符号和中英文识别错误，并按照语义划分段落以便后续的分段总结。
特别注意：
1. 专有名词的准确性
2. 专业术语的正确性
3. 合理地划分段落
4.时间戳文本内的每句话也要同步按要求做修改，尤其是标点符号
请以JSON格式返回纠正结果。"""
            },
            {
                "role": "user",
                "content": f"""请结合要求和内容，纠正字幕文本中的错误：
字幕文本：
{text},
时间戳文本：
{segments}
请以JSON格式返回纠正后的文本，格式为：
{{"corrected_text": "纠正后的文本"}}
{{"segments": "纠正后的时间戳文本"}}"""
            }
        ]

        # 调用API获取纠错结果
        completion = client.chat.completions.create(
            model="qwen-plus",
            messages=messages,
            stream=False,
            response_format={"type": "json_object"}
        )

        # 解析返回的JSON对象
        result = json.loads(completion.choices[0].message.content)

        # 提取纠正后的文本和时间戳
        corrected_text = result.get("corrected_text", "")
        segments = result.get("segments", segments)  # 如果没有返回segments，则使用原始segments

        return corrected_text, segments
    except Exception as e:
        print(f"纠正字幕文本失败: {str(e)}")
        return {
            "corrected_text": "无法纠正字幕文本",
            "error": str(e)
        }

def split_video_to_frames(video_path, fps, video_id):
    """使用ffmpeg按FPS截帧"""
    app.logger.info(f"开始切分视频，帧率: {fps} fps...")

    frames_dir = os.path.join(app.config['FRAMES_FOLDER'], video_id)
    os.makedirs(frames_dir, exist_ok=True)

    cmd = [
        'ffmpeg', '-i', video_path, '-vf', f'fps={fps}', '-f', 'image2',
        '-c:v', 'png', '-compression_level', '1', '-y',
        os.path.join(frames_dir, '%04d.png')
    ]

    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True,
        encoding='utf-8'  # 显式指定编码为 UTF-8
     )
        app.logger.info("视频切分完成!")
        return frames_dir
    except subprocess.CalledProcessError as e:
        app.logger.error(f"视频切分失败: {e.stderr}")
        return None
    except FileNotFoundError:
        app.logger.error("未找到ffmpeg，请确保ffmpeg已安装并添加到系统PATH")
        return None


def split_video_at_timestamps(video_path, video_id, heavys):
    """
    按给定时间戳列表精确截帧
    :return: 截图目录路径；失败返回 None
    """
    # 参数校验
    if not video_path:
        app.logger.error("video_path 不能为 None 或空值")
        return None
    if not video_id:
        app.logger.error("video_id 不能为 None 或空值")
        return None
    if 'FRAMES_FOLDER' not in app.config or not app.config['FRAMES_FOLDER']:
        app.logger.error("FRAMES_FOLDER 配置不存在或为空")
        return None
    if not heavys:
        app.logger.error("heavys 列表不能为空")
        return None

    base_dir = os.path.join(app.config['FRAMES_FOLDER'], video_id)
    os.makedirs(base_dir, exist_ok=True)

    # 统一参数模板（注意输出路径的位置）
    cmd_tpl = [
        'ffmpeg', '-hide_banner', '-loglevel', 'error',
        '-ss', '{time}',  # 输入前 seek，精度高
        '-i', video_path,
        '-vframes', '1',  # 只取一帧
        '-f', 'image2',
        '-c:v', 'png',
        '-y',  # 覆盖
        None  # 输出路径，循环里填（最后一个元素）
    ]

    for idx, heavy in enumerate(heavys, start=1):
        # 检查时间范围数据是否完整
        if 'time_range' not in heavy:
            app.logger.error(f"第 {idx} 个heavy缺少time_range字段")
            return None
        time_range = heavy['time_range']
        if 'start_time' not in time_range:
            app.logger.error(f"第 {idx} 个heavy缺少start_time字段")
            return None

        timestamp = time_range['start_time']
        # 验证时间戳格式（简单检查是否为HH:MM:SS格式）
        if not re.match(r'^\d{2}:\d{2}:\d{2}$', timestamp):
            app.logger.error(f"第 {idx} 个时间戳格式错误: {timestamp}，应为HH:MM:SS")
            return None

        outfile = os.path.join(base_dir, f'heavy{idx}.png')

        # 复制命令模板并替换参数（关键修正：修改最后一个元素为输出路径）
        cmd = cmd_tpl.copy()
        cmd[-1] = outfile  # 修正这里！输出路径是最后一个参数
        cmd[4] = timestamp  # 直接使用HH:MM:SS格式，无需转str

        try:
            # 执行命令
            result = subprocess.run(
                cmd,
                check=True,
                capture_output=True,
                text=True
            )
            app.logger.info(f'已截图: {outfile}  (t={timestamp})')
        except subprocess.CalledProcessError as e:
            app.logger.error(f'截图失败 t={timestamp}: {e.stderr}')
            return None
        except FileNotFoundError:
            app.logger.error('未找到 ffmpeg，请确保已安装并加入 PATH')
            return None

    app.logger.info(f'全部截图完成，共 {len(heavys)} 张 → {base_dir}')
    return base_dir


def get_sorted_image_files(frames_dir):
    """获取排序后的帧图片列表"""
    # 只会检测该目录下的图片 生成的original_backup文件夹不会检测到
    image_files = []
    for ext in ('.jpg', '.jpeg', '.png'):
        image_files.extend(glob.glob(os.path.join(frames_dir, f"*{ext}")))

    filtered_files = []
    for file in image_files:
        try:
            filename = os.path.basename(file)
            num = int(os.path.splitext(filename)[0])
            filtered_files.append((num, file))
        except ValueError:
            continue

    sorted_files = sorted(filtered_files, key=lambda x: x[0])
    return [file for _, file in sorted_files]


def get_captions_for_time_range(speech_segments, start_time, end_time):
    """获取指定时间范围内的字幕"""
    captions = []
    for segment in speech_segments:
        # 检查语音片段是否与当前帧时间范围重叠
        if not (segment['end_time'] < start_time or segment['start_time'] > end_time):
            captions.append(segment['text'])
    return " ".join(captions) if captions else "无语音内容"

def semantic_divide(text,segments):
    try:
        # 构建消息内容，确保包含"json"字样
        messages = [
            {
                "role": "system",
                "content": """你是一个专业的文案理解分段员，请按照语义划分段落是为了后续的分段总结。
    特别注意：
    1. 合理地划分段落，每个段落对应一个小标题，并保证每个段落下有三个非常具体的小分点总结
    2.针对字幕文本分段后，从时间戳文本中获取分段对应的时间。
    3.根据分段从中找出合适的重点内容，也需要获得时间戳信息。
    4.所有时间戳的格式必须得是hh:mm:ss的时分秒有:间隔的格式,并且分成start_time和end_time，
    因为我要单独获取这两个数据！
    请以JSON格式返回结果。"""
            },
            {
                "role": "user",
                "content": f"""请结合要求和内容，合理的分段：
    字幕文本：
    {text},
    时间戳文本：
    {segments}
    请以JSON格式返回分段文本，格式为：
    {{"division": "分段的小标题title + 时间戳字符串time_range(包括start_time和end_time) + 三个小分点总结summary"}}
    {{"heavys": "重点的小标题title+时间戳字符串time_range(包括start_time和end_time)"}}"""
            }
        ]

        # 调用API获取纠错结果
        completion = client.chat.completions.create(
            model="qwen-plus",
            messages=messages,
            stream=False,
            response_format={"type": "json_object"}
        )

        # 解析返回的JSON对象
        result = json.loads(completion.choices[0].message.content)

        # 提取纠正后的文本和时间戳
        division = result.get("division", "")
        heavys = result.get("heavys", "")

        return division, heavys
    except Exception as e:
        print(f"分段语义文本失败: {str(e)}")



def analyze_frame(text,image_path, captions):
    """结合字幕分析帧内容"""
    try:
        # 读取图片并转换为base64
        with open(image_path, "rb") as img_file:
            base64_image = base64.b64encode(img_file.read()).decode("utf-8")

        mime_type = 'image/png' if image_path.endswith('.png') else 'image/jpeg'
        image_url = f"data:{mime_type};base64,{base64_image}"

        # 调用千问模型分析图片（结合语音字幕）
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_url}},
                    {"type": "text", "text": f"""请结合语音内容解析视频中的这一帧传达的内容：{captions}
                    返回markdown笔记的JSON格式包含：
                    1. 标题：简洁描述（大概20字）
                    2. 摘要：简要内容（大概100字）
                    3. 所有内容返回markdown的笔记格式，要求使用到三种级别的标题，并且一般分三点细节解说摘要！
                    4.笔记中既要有专业术语的体现，又要循循善诱。
                    5.在合适的位置出现emoji图标，增加积极的丰富性。
                    6.需要把图片一起加上去，形成图文混排的笔记格式。
                    仅返回markdown笔记，名称为notes，是JSON格式。"""
                     }
                ]
            }
        ]

        completion = client.chat.completions.create(
            model="qwen-vl-plus",
            messages=messages,
            stream=False,
            response_format={"type": "json_object"}
        )

        return json.loads(completion.choices[0].message.content)

    except Exception as e:
        app.logger.error(f"图片分析失败: {str(e)}")
        return {
            "标题": "分析失败",
            "摘要": "无法解析图片内容",
            "亮点": ["分析错误"],
            "详细内容": f"图片分析错误: {str(e)}"
        }

def generate_mind_map(text):
    """基于视频全文字幕生成前端可渲染的AI脑图"""
    try:
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": f"""基于视频全文字幕生成前端可直接渲染的AI脑图，需严格遵循以下格式和要求：
1. 核心目标：输出结构包含「脑图基础配置」和「层级数据」，支持前端快速渲染（如vue-mindmap、mind-elixir等库）。
2. 输出格式规范：
   {{
     "mind_map": 
     {{
       "config": {{  // 前端渲染基础配置（直接用于脑图组件参数）
         "root_name": "视频核心主题（1级节点）",  // 根节点名称（≤15字，带emoji）
         "theme": "light",  // 主题标识（固定值：light/dark，方便前端切换样式）
         "default_icon": "📌",  // 默认节点图标（适配不同类型节点）
         "level_styles": {{  // 各层级样式配置（前端可直接映射CSS）
           "1": {{ "font_size": "18px", "font_weight": "bold", "color": "#2563eb" }},
           "2": {{ "font_size": "16px", "font_weight": "bold", "color": "#10b981" }},
           "3": {{ "font_size": "14px", "font_weight": "normal", "color": "#6b7280" }},
           "4": {{ "font_size": "12px", "font_weight": "normal", "color": "#9ca3af" }}
         }}
       }},
       "data": {{  // 层级数据（嵌套结构，前端可直接遍历渲染）
         "id": "root",  // 根节点ID（固定为root）
         "name": "📌视频核心主题（1级节点）",  // 同config.root_name，带emoji
         "level": 1,  // 层级标识（1-4级）
         "children": [  // 子节点列表（每个子节点结构与父节点一致）
           {{
             "id": "level2_1",  // 唯一ID（格式：level+层级_序号，如level2_1）
             "name": "🔧二级分类1（如：概念解析）",  // ≤20字，带emoji
             "level": 2,
             "children": [
               {{
                 "id": "level3_1_1",
                 "name": "📝三级要点1（如：核心术语定义）",  // ≤25字，带emoji
                 "level": 3,
                 "children": [
                   {{
                     "id": "level4_1_1_1",
                     "name": "四级补充：术语通俗解释（贴合字幕内容，≤50字）",  // 带细节说明
                     "level": 4,
                     "children": []  // 四级节点无子集（固定为空数组）
                   }}
                   // 更多四级节点...
                 ]
               }}
               // 更多三级节点...
             ]
           }}
           // 更多二级节点...
         ]
       }}
     }}
   }}
3. 内容要求：
   - 数据严格贴合视频全文字幕，不添加主观信息；
   - 每个节点ID唯一（格式：level+层级_序号，如level2_2表示二级分类第2个）；
   - 1-4级节点必须完整，覆盖字幕中的核心概念、流程、案例、结论；
   - 专业术语需在四级节点补充通俗解释（如：「API接口→应用程序编程接口，用于软件间数据交互」）。
4. 输出限制：仅返回上述JSON结构，不包含任何额外文字，确保前端可直接用JSON.parse解析。

视频全文字幕内容：{text}
"""}
                ]
            }
        ]

        completion = client.chat.completions.create(
            model="qwen-vl-plus",
            messages=messages,
            stream=False,
            response_format={"type": "json_object"}
        )

        return json.loads(completion.choices[0].message.content)

    except Exception as e:
        app.logger.error(f"AI脑图生成失败: {str(e)}")
        # 错误时返回兼容格式，前端可捕获并显示错误
        return {
            "mind_map": {
                "config": {
                    "root_name": "📌脑图生成失败",
                    "theme": "light",
                    "default_icon": "❌",
                    "level_styles": {
                        "1": {"font_size": "18px", "font_weight": "bold", "color": "#ef4444"}
                    }
                },
                "data": {
                    "id": "root",
                    "name": "📌脑图生成失败",
                    "level": 1,
                    "children": [
                        {
                            "id": "error_1",
                            "name": f"❌错误原因：{str(e)}",
                            "level": 2,
                            "children": []
                        }
                    ]
                }
            }
        }

def generate_summary(text):
    """生成全文摘要和亮点"""
    try:
        messages = [
            {
                "role": "system",
                "content": "你是一个专业的视频内容分析专家，根据文本内容生成对视频的整体摘要和亮点。"
            },
            {
                "role": "user",
                "content": f"""根据文本生成内容：
                1. 整体摘要（300字左右），按照“该视频主要讲述了... 首先...然后...接着...最后...”的顺序描述。
                3.根据文本内容检测出2-5个视频的亮点内容，返回亮点内容的小标题（10字左右）
                文本内容：{text}
                用JSON返回，包含"summary"和"highlights"字段。"""
            }
        ]

        completion = client.chat.completions.create(
            model="qwen-plus",
            messages=messages,
            stream=False,
            response_format={"type": "json_object"}
        )

        return json.loads(completion.choices[0].message.content)
    except Exception as e:
        app.logger.error(f"生成摘要失败: {str(e)}")
        return {
            "summary": "无法生成视频摘要",
            "highlights": ["生成摘要时发生错误"]
        }

#把generate_summary，generate_mind_map，semantic_divide三个基于修正字幕的函数修正
def all3(text, speech_segments):
    """你的主函数，并行执行两个任务"""
    # 定义用于存储并行结果的变量（用列表/字典存储，因为线程内不能直接返回值）
    result = {}

    # 任务1：执行 semantic_divide
    def task_semantic_divide():
        division, heavys = semantic_divide(text, speech_segments)
        result['division'] = division
        result['heavys'] = heavys

    # 任务2：执行 generate_mind_map
    def task_generate_mind_map():
        mind_map = generate_mind_map(text)
        result['mind_map'] = mind_map

    def task_generate_summary():
        summary_result= generate_summary(text)
        result['summary_result'] = summary_result

    # 方式1：用 ThreadPoolExecutor 管理线程（更简洁，自动管理线程生命周期）
    with ThreadPoolExecutor(max_workers=3) as executor:  # 最多2个线程并行
        # 提交三个任务到线程池
        future1 = executor.submit(task_semantic_divide)
        future2 = executor.submit(task_generate_mind_map)
        future3 = executor.submit(task_generate_summary)

        # 等待三个任务都执行完成（阻塞，直到所有任务结束）
        future1.result()
        future2.result()
        future3.result()

    # 并行执行完成后，从result中获取结果
    division = result['division']
    heavys = result['heavys']
    mind_map = result['mind_map']
    summary_result = result['summary_result']

    return division, heavys, mind_map,summary_result


def generate_error_image(message):
    """生成一张包含错误信息的图片（替代JSON错误响应）"""
    # 创建一张200x100的空白图片
    img = Image.new('RGB', (400, 200), color=(240, 240, 240))
    draw = ImageDraw.Draw(img)

    # 尝试加载系统字体（如果没有则不显示文字）
    try:
        font = ImageFont.truetype('arial.ttf', 16)  # Windows系统字体
    except:
        try:
            font = ImageFont.truetype('/Library/Fonts/Arial.ttf', 16)  # macOS系统字体
        except:
            font = None  # 无字体时不绘制文字

    # 在图片上绘制错误信息
    if font:
        draw.text((20, 80), message, fill=(255, 0, 0), font=font)
    else:
        draw.text((20, 80), message, fill=(255, 0, 0))  # 无字体时使用默认样式

    # 将图片转为字节流返回
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='PNG')
    img_byte_arr.seek(0)

    # 返回图片响应（指定MIME类型）
    from flask import make_response
    response = make_response(img_byte_arr.getvalue())
    response.headers['Content-Type'] = 'image/png'
    return response

@app.route('/upload', methods=['POST'])
def upload_file():
    """处理视频上传"""
    if 'video' not in request.files:
        return jsonify({"success": False, "error": "未找到视频文件"})

    file = request.files['video']
    if file.filename == '':
        return jsonify({"success": False, "error": "未选择视频文件"})

    if file and allowed_file(file.filename):
        video_id = str(uuid.uuid4())
        file_ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'mp4'
        filename = f"{video_id}.{file_ext}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)

        return jsonify({
            "success": True,
            "filepath": filename,
            "video_id": video_id
        })

    return jsonify({"success": False, "error": "不支持的文件格式"})


@app.route('/analyze', methods=['POST'])
def analyze_video():
    """分析视频（截帧+语音识别+帧分析+生成摘要）"""
    data = request.get_json()
    if not data or 'filepath' not in data:
        return jsonify({"success": False, "error": "缺少视频路径参数"})

    video_path = os.path.join(app.config['UPLOAD_FOLDER'], data['filepath'])
    video_id = data.get('video_id', str(uuid.uuid4()))
    if not os.path.exists(video_path):
        return jsonify({"success": False, "error": "视频文件不存在"})

    try:
        # 1. 获取视频时长
        duration = get_video_duration(video_path)
        app.logger.info(f"视频时长: {duration:.2f}秒")

        # 2. 提取音频并转文字
        audio_path = extract_audio_from_video(video_path, video_id)
        speech_segments,text = speech_to_text(audio_path) if audio_path else ([], "")
        text,speech_segments=correct_text(text,speech_segments);
        # 我把三个函数并发执行了
        division,heavys,mind_map,summary_result=all3(text, speech_segments);
        # 获取heavys对应时间戳的画面

        # 3. 动态设置帧率（确保合理的截帧数量）
        if duration < 60:  # <1分钟
            fps = 1/6  # 1秒1帧
        elif duration < 300:  # <5分钟
            fps = 0.5  # 2秒1帧
        else:  # ≥5分钟
            fps = 0.2  # 5秒1帧
        app.logger.info(f"选择帧率: {fps} fps（预计生成 {int(duration * fps)} 帧）")

        heavys_dir=split_video_at_timestamps(video_path,video_id,heavys);
        # 4. 截帧处理
        frames_dir = split_video_to_frames(video_path, fps, video_id)
        if not frames_dir:
            return jsonify({"success": False, "error": "视频切分失败"})
        # 在这里对抽帧的图片做相似度的处理 生成PPT
        generate_ppt(frames_dir,threshold_input=0.95)
        time.sleep(1)  # 等待文件写入

        sorted_images = get_sorted_image_files(frames_dir)
        if not sorted_images:
            return jsonify({"success": False, "error": "未找到帧图片"})

        # 5. 分析每帧并匹配字幕
        segments = []
        prev_end_time=0
        for i,image_path in enumerate(tqdm(sorted_images, desc="处理进度")):
            # 计算当前帧的名称来计算时间范围 根据ppt来进行划分
            basename=os.path.basename(image_path)
            frame_name=basename[:4]
            i=int(frame_name)
            frame_start_time = prev_end_time
            frame_end_time = i  / fps
            prev_end_time=frame_end_time
            time_range = f"{timedelta(seconds=int(frame_start_time))} - {timedelta(seconds=int(frame_end_time))}"

            # 获取该时间范围内的字幕
            frame_captions = get_captions_for_time_range(speech_segments, frame_start_time, frame_end_time)

            # 分析帧内容（结合字幕）
            frame_analysis = analyze_frame(text,image_path, frame_captions)

            BASE_URL = 'http://localhost:5000'
            # 构建分段信息
            segments.append({
                "notes": frame_analysis["notes"],
                "image": BASE_URL+ f"/frames/{video_id}/{os.path.basename(image_path)}",
                "time_range": time_range,
                "captions": frame_captions  # 对应时间的字幕
            })
            time.sleep(1)  # 控制API调用频率

        # 7. 保存结果并返回
        result = {
            "summary": summary_result["summary"],
            "highlights": summary_result["highlights"],
            "segments": segments,
            "division":division,
            "heavys":heavys,
            "mind_map":mind_map
        }

        result_path = os.path.join(app.config['OUTPUT_FOLDER'], f"{video_id}_result.json")
        with open(result_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        return jsonify({"success": True, "result": result,"video_id": video_id})

    except Exception as e:
        app.logger.error(f"视频分析失败: {str(e)}")
        return jsonify({"success": False, "error": f"视频分析失败: {str(e)}"})


@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# 返回图片名称数组的路由
@app.route('/frames/<video_id>',methods=['GET'])
def get_PPT(video_id):
    frame_folder=os.path.join(app.config['FRAMES_FOLDER'], video_id)
    ppt=[];
    heavy=[];
    for file in os.listdir(frame_folder):
        if file.endswith('.png') :
            if file.startswith('heavy'):
                heavy.append(f"/frames/{video_id}/{file}")
            else:
                ppt.append(f"/frames/{video_id}/{file}")
    return jsonify({"success": True, "ppt": ppt,"heavy":heavy})

# 需要添加下面的路由 单个图片才可以访问到！
# 新增：用于直接访问图片文件的路由
@app.route('/frames/<video_id>/<filename>', methods=['GET'])
def get_frame_image(video_id, filename):
    # 拼接图片所在的文件夹路径
    frame_folder = os.path.join(app.config['FRAMES_FOLDER'], video_id)

    # 验证文件是否存在且是PNG格式
    if not os.path.exists(frame_folder):
        return jsonify({"success": False, "error": "视频帧文件夹不存在"}), 404

    if not filename.endswith('.png'):
        return jsonify({"success": False, "error": "只支持PNG格式图片"}), 400

    # 显示MIME的告诉前端是图片
    try:
        return send_from_directory(frame_folder, filename,mimetype='image/png')
    except FileNotFoundError:
        return generate_error_image("图片文件不存在"),404

if __name__ == '__main__':
    # # 自动安装依赖
    # required_packages = ['flask-cors', 'tqdm', 'openai', 'baidu-aip', 'chardet']
    # for package in required_packages:
    #     try:
    #         __import__(package)
    #     except ImportError:
    #         subprocess.run(["pip", "install", package])

    app.run(host='0.0.0.0', port=5000, debug=True)