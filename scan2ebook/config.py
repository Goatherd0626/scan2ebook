"""运行配置：从环境变量 / .env 读取。"""
import os

from dotenv import load_dotenv

load_dotenv()

# ---- DeepSeek API（可选，用于结构识别/元数据提取）----
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
DEEPSEEK_CHAT_MODEL = os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-chat")
DEEPSEEK_VISION_MODEL = os.getenv("DEEPSEEK_VISION_MODEL", "deepseek-v4-flash-vision-exp")

# ---- OCR 配置 ----
OCR_DPI = int(os.getenv("OCR_DPI", "300"))
# Apple Vision 语言偏好；逗号分隔。zh-Hans 简体 / zh-Hant 繁体 / en-US 英文
OCR_LANGUAGES = [x.strip() for x in os.getenv("OCR_LANGUAGES", "zh-Hans,zh-Hant,en-US").split(",") if x.strip()]

# ---- 版面阈值（归一化坐标 0~1，原点左上）----
LAYOUT_HEADER_BAND = float(os.getenv("LAYOUT_HEADER_BAND", "0.09"))      # 页眉区上界
LAYOUT_FOOTER_BAND = float(os.getenv("LAYOUT_FOOTER_BAND", "0.90"))      # 页脚区下界起点
LAYOUT_FOOTNOTE_BAND = float(os.getenv("LAYOUT_FOOTNOTE_BAND", "0.68"))  # 脚注区起点

# ---- 标题识别阈值 ----
HEADING_MAX_CHARS = int(os.getenv("HEADING_MAX_CHARS", "45"))
HEADING_GAP_RATIO = float(os.getenv("HEADING_GAP_RATIO", "1.5"))  # 与下一块间距 ≥ 行高 × 该值
