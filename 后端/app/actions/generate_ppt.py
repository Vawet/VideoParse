import os
import shutil
from transformers import CLIPVisionModel, CLIPImageProcessor
from PIL import Image
import torch
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
import time

# 1. 加载CLIP-Large模型和图片处理器
print("正在加载CLIP-Large模型...")
model = CLIPVisionModel.from_pretrained("openai/clip-vit-large-patch14")
processor = CLIPImageProcessor.from_pretrained("openai/clip-vit-large-patch14")

# 确保模型在GPU上运行（如果有）
device = "cuda" if torch.cuda.is_available() else "cpu"
model.to(device)
print(f"模型运行设备：{device}")


# 2. 定义函数：将图片转换为向量（优化：添加设备支持）
def image_to_vector(image_path):
    """
    输入：图片路径
    输出：CLIP生成的768维向量
    """
    try:
        image = Image.open(image_path).convert("RGB")
        inputs = processor(images=image, return_tensors="pt").to(device)  # 移到对应设备
        with torch.no_grad():
            outputs = model(**inputs)
        # 计算特征向量并移回CPU转为numpy
        vector = outputs.last_hidden_state.mean(dim=1).squeeze().cpu().numpy()
        return vector
    except Exception as e:
        print(f"处理图片 {image_path} 时出错：{str(e)}")
        return None


# 3. 定义函数：计算两张图片的相似度
def compare_images(image1_path, image2_path):
    """
    输入：两张图片的路径
    输出：相似度分数（0-1之间，越接近1越相似）
    """
    try:
        vec1 = image_to_vector(image1_path)
        vec2 = image_to_vector(image2_path)

        if vec1 is None or vec2 is None:
            return 0.0  # 无效向量视为不相似

        similarity = cosine_similarity([vec1], [vec2])[0][0]
        return similarity
    except Exception as e:
        print(f"比较图片 {image1_path} 和 {image2_path} 时出错：{str(e)}")
        return 0.0


# 4. 定义函数：处理有序抽帧图片（核心优化：仅比较相邻保留帧）
def process_ordered_frames(folder_path, similarity_threshold=0.85):
    """
    处理视频有序抽帧图片，仅通过相邻帧相似度去重（保留第一张相似帧）
    :param folder_path: 抽帧图片文件夹路径
    :param similarity_threshold: 相似度阈值，高于此值视为重复帧
    """
    if not os.path.exists(folder_path):
        print(f"错误：文件夹 {folder_path} 不存在")
        return

    # 获取文件夹中的所有图片文件，并按文件名排序（关键：保持抽帧时序）
    image_extensions = ('.png', '.jpg', '.jpeg')
    image_files = [
        f for f in os.listdir(folder_path)
        if f.lower().endswith(image_extensions)
    ]

    # 按文件名自然排序（确保按抽帧顺序处理，如frame_001.jpg、frame_002.jpg）
    image_files.sort(
        key=lambda x: int(''.join(filter(str.isdigit, x)))
        if any(c.isdigit() for c in x)
        else x
    )

    if not image_files:
        print(f"警告：文件夹中没有找到图片文件")
        return

    total_images = len(image_files)
    print(f"发现 {total_images} 张有序抽帧图片，开始处理...")

    # 创建临时文件夹存放保留的图片
    temp_folder = os.path.join(folder_path, "temp_kept_frames")
    os.makedirs(temp_folder, exist_ok=True)

    # 初始化保留列表（始终保留第一张图片）
    kept_images = [image_files[0]]
    # 将第一张图片移到临时文件夹
    first_img_path = os.path.join(folder_path, image_files[0])
    shutil.copy2(first_img_path, os.path.join(temp_folder, image_files[0]))  # 用copy避免移动原文件
    print(f"保留第1张图片：{image_files[0]}（作为初始帧）")

    # 从第二张图片开始处理，仅与上一张保留的图片比较
    for i in range(1, total_images):
        current_img = image_files[i]
        current_img_path = os.path.join(folder_path, current_img)

        # 上一张保留的图片路径
        prev_kept_img = kept_images[-1]
        prev_kept_path = os.path.join(folder_path, prev_kept_img)

        # 计算当前帧与上一张保留帧的相似度
        similarity = compare_images(current_img_path, prev_kept_path)

        # 判断是否重复
        if similarity > similarity_threshold:
            print(
                f"进度：{i + 1}/{total_images} - 图片 {current_img} 与上一保留帧 {prev_kept_img} "
                f"相似度 {similarity:.4f} > {similarity_threshold}，标记为重复帧"
            )
        else:
            # 保留当前帧
            kept_images.append(current_img)
            shutil.copy2(current_img_path, os.path.join(temp_folder, current_img))
            print(
                f"进度：{i + 1}/{total_images} - 图片 {current_img} 与上一保留帧 {prev_kept_img} "
                f"相似度 {similarity:.4f} ≤ {similarity_threshold}，保留为新关键帧"
            )

        # 每处理10张图片显示一次进度
        if (i + 1) % 10 == 0:
            print(f"已处理 {i + 1}/{total_images} 张图片，当前保留 {len(kept_images)} 张关键帧")

    # 清理原文件夹并将保留的图片移回
    print("\n开始整理结果...")
    # 先备份原图片（可选，防止误删）
    backup_folder = os.path.join(folder_path, "original_backup")
    os.makedirs(backup_folder, exist_ok=True)

    for img in image_files:
        src = os.path.join(folder_path, img)
        if os.path.exists(src):  # 避免重复备份
            shutil.move(src, os.path.join(backup_folder, img))

    # 将临时文件夹中的保留图片移回原文件夹
    for img in kept_images:
        src = os.path.join(temp_folder, img)
        shutil.move(src, os.path.join(folder_path, img))

    # 删除临时文件夹
    try:
        os.rmdir(temp_folder)
        print("临时文件夹已清理")
    except Exception as e:
        print(f"删除临时文件夹时出错：{str(e)}")

    print(f"\n处理完成！")
    print(f"原始抽帧数量：{total_images}")
    print(f"保留关键帧数量：{len(kept_images)}")
    print(f"删除重复帧数量：{total_images - len(kept_images)}")
    print(f"原始图片已备份至：{backup_folder}")


# 5. 封装成主函数
def generate_ppt(folder_path,threshold_input):
    print("视频有序抽帧图片去重工具（仅比较相邻帧）")
    print("功能：针对视频按顺序抽取的帧图片，通过相邻帧相似度判断，保留非重复的关键帧")
    # 获取相似度阈值（视频抽帧建议0.8~0.9）
    # threshold_input = input("请输入相似度阈值（0-1之间，默认0.85，值越高保留越多帧）：")
    try:
        similarity_threshold = float(threshold_input) if threshold_input else 0.85
        if not 0 <= similarity_threshold <= 1:
            raise ValueError("相似度阈值必须在0-1之间")
    except ValueError as e:
        print(f"没有输出或输入错误：{str(e)}，使用默认值0.85")
        similarity_threshold = 0.85

    print("\n开始处理图片...")
    start_time = time.time()

    try:
        process_ordered_frames(folder_path, similarity_threshold)
    except KeyboardInterrupt:
        print("\n用户中断处理...")
        print("已处理部分图片，结果可能不完整")
    except Exception as e:
        print(f"\n处理过程中发生错误：{str(e)}")
    finally:
        end_time = time.time()
        print(f"\n总耗时：{end_time - start_time:.2f}秒")
