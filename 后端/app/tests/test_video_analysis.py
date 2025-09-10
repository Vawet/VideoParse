import os
import json
import requests
import pytest
from uuid import UUID

# -------------------------- 全局配置 --------------------------
# 服务端基础 URL（本地运行时默认此地址）
BASE_URL = "http://localhost:5000"
# 测试视频路径（请确保该视频存在，格式为 MP4/AVI 等允许的格式）
TEST_VIDEO_PATH = os.path.join(os.path.dirname(__file__), "test_videos", "test_video.mp4")
# 允许的视频格式（与服务端 ALLOWED_EXTENSIONS 保持一致）
ALLOWED_VIDEO_EXTENSIONS = {"mp4", "mov", "avi", "mkv", "flv"}


# -------------------------- 测试前置/后置操作 --------------------------
@pytest.fixture(scope="module")
def test_video_info():
    """
    模块级 Fixture：执行所有测试前先上传测试视频，获取 video_id 和 filepath；
    测试结束后可选择性清理测试文件（可选）。
    """
    # 1. 前置操作：上传测试视频
    if not os.path.exists(TEST_VIDEO_PATH):
        raise FileNotFoundError(f"测试视频不存在：{TEST_VIDEO_PATH}")

    # 检查视频格式是否合法
    video_ext = TEST_VIDEO_PATH.rsplit(".", 1)[-1].lower()
    assert video_ext in ALLOWED_VIDEO_EXTENSIONS, f"不支持的视频格式：{video_ext}"

    # 发送上传请求
    upload_url = f"{BASE_URL}/upload"
    with open(TEST_VIDEO_PATH, "rb") as f:
        files = {"video": (os.path.basename(TEST_VIDEO_PATH), f, f"video/{video_ext}")}
        response = requests.post(upload_url, files=files)

    # 验证上传成功
    assert response.status_code == 200, f"视频上传失败，状态码：{response.status_code}"
    upload_result = response.json()
    assert upload_result["success"] is True, f"上传响应失败：{upload_result.get('error')}"

    # 提取关键信息（供后续测试使用）
    video_info = {
        "video_id": upload_result["video_id"],
        "filepath": upload_result["filepath"]
    }

    # 验证 video_id 格式合法（UUID）
    assert isinstance(UUID(video_info["video_id"], version=4), UUID), "video_id 格式不是合法 UUID"

    yield video_info  # 提供给测试用例使用

    # 2. 后置操作（可选）：测试结束后清理服务端生成的文件（需服务端提供清理接口，此处注释为示例）
    # clean_url = f"{BASE_URL}/clean/{video_info['video_id']}"
    # requests.delete(clean_url)


# -------------------------- 核心测试用例 --------------------------
def test_upload_video_invalid_format():
    """测试上传不支持的视频格式（异常场景）"""
    upload_url = f"{BASE_URL}/upload"
    # 构造一个不支持的格式（如 .txt）
    invalid_video_path = os.path.join(os.path.dirname(__file__), "test_videos", "invalid.txt")
    # 若文件不存在，临时创建一个空文件
    if not os.path.exists(invalid_video_path):
        with open(invalid_video_path, "w") as f:
            f.write("test")

    with open(invalid_video_path, "rb") as f:
        files = {"video": ("invalid.txt", f, "text/plain")}
        response = requests.post(upload_url, files=files)

    assert response.status_code == 200
    result = response.json()
    assert result["success"] is False, "上传不支持的格式应返回失败"
    assert "不支持的文件格式" in result.get("error", ""), "错误信息不符合预期"


def test_analyze_video(test_video_info):
    """测试视频分析核心流程（上传 → 分析 → 结果验证）"""
    # 1. 构造分析请求参数
    analyze_url = f"{BASE_URL}/analyze"
    analyze_data = {
        "video_id": test_video_info["video_id"],
        "filepath": test_video_info["filepath"]
    }

    # 2. 发送分析请求（视频分析可能耗时，需设置较长超时时间）
    response = requests.post(analyze_url, json=analyze_data, timeout=300)  # 5分钟超时

    # 3. 验证分析响应状态
    assert response.status_code == 200, f"视频分析请求失败，状态码：{response.status_code}"
    analyze_result = response.json()
    assert analyze_result["success"] is True, f"视频分析失败：{analyze_result.get('error')}"

    # 4. 验证分析结果结构完整性（核心字段是否存在）
    required_fields = ["summary", "highlights", "segments", "division", "heavys", "mind_map"]
    for field in required_fields:
        assert field in analyze_result["result"], f"分析结果缺少核心字段：{field}"

    # 5. 验证具体字段的合理性
    result = analyze_result["result"]
    # - 摘要不为空
    assert len(result["summary"].strip()) > 0, "视频摘要为空"
    # - 亮点数量符合预期（2-5个）
    assert 2 <= len(result["highlights"]) <= 5, f"亮点数量不符合预期：{len(result['highlights'])}"
    # - 分段结果不为空
    assert len(result["segments"]) > 0, "视频分段结果为空"
    # - 脑图结果包含基础配置和数据
    assert "config" in result["mind_map"]["mind_map"], "脑图结果缺少 config 字段"
    assert "data" in result["mind_map"]["mind_map"], "脑图结果缺少 data 字段"


def test_get_ppt_frames(test_video_info):
    """测试获取 PPT 帧图片列表（普通帧 + heavy 帧）"""
    # 1. 发送获取帧列表请求
    ppt_url = f"{BASE_URL}/frames/{test_video_info['video_id']}"
    response = requests.get(ppt_url)

    # 2. 验证响应状态
    assert response.status_code == 200, f"获取帧列表失败，状态码：{response.status_code}"
    ppt_result = response.json()
    assert ppt_result["success"] is True, f"获取帧列表失败：{ppt_result.get('error')}"

    # 3. 验证帧列表结构
    assert "ppt" in ppt_result, "帧列表缺少 'ppt' 字段（普通帧）"
    assert "heavy" in ppt_result, "帧列表缺少 'heavy' 字段（重点帧）"

    # 4. 验证至少有一个普通帧（视频截帧成功）
    assert len(ppt_result["ppt"]) > 0, "未获取到普通帧图片"
    # 5. 验证 heavy 帧格式（若有）
    if len(ppt_result["heavy"]) > 0:
        for heavy_url in ppt_result["heavy"]:
            assert heavy_url.startswith(f"/frames/{test_video_info['video_id']}/heavy"), "heavy 帧 URL 格式异常"


def test_get_single_frame_image(test_video_info):
    """测试获取单个帧图片（验证图片可访问）"""
    # 1. 先获取帧列表
    ppt_url = f"{BASE_URL}/frames/{test_video_info['video_id']}"
    ppt_result = requests.get(ppt_url).json()
    assert len(ppt_result["ppt"]) > 0, "无普通帧可测试"

    # 2. 取第一个普通帧的 URL，拼接完整请求地址
    first_frame_path = ppt_result["ppt"][0]
    frame_url = f"{BASE_URL}{first_frame_path}"

    # 3. 发送图片请求，验证图片可正常获取
    response = requests.get(frame_url)
    assert response.status_code == 200, f"获取帧图片失败，状态码：{response.status_code}"
    # 验证返回的是图片（Content-Type 包含 image）
    assert "image" in response.headers.get("Content-Type", ""), "返回内容不是图片格式"
    # 验证图片内容不为空
    assert len(response.content) > 0, "获取的图片内容为空"


def test_get_nonexistent_frame(test_video_info):
    """测试获取不存在的帧图片（异常场景）"""
    # 构造一个不存在的帧图片 URL
    nonexistent_frame_url = f"{BASE_URL}/frames/{test_video_info['video_id']}/nonexistent.png"
    response = requests.get(nonexistent_frame_url)

    # 验证返回 404 错误
    assert response.status_code == 404, f"获取不存在的帧应返回 404，实际状态码：{response.status_code}"
    error_result = response.json()
    assert error_result["success"] is False, "获取不存在的帧应返回失败"
    assert "图片文件不存在" in error_result.get("error", ""), "错误信息不符合预期"