"""运行配置：从环境变量 / .env 读取。"""
import os

from dotenv import load_dotenv

load_dotenv()

# ---- DeepSeek API ----
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
DEEPSEEK_CHAT_MODEL = os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-chat")
DEEPSEEK_VISION_MODEL = os.getenv("DEEPSEEK_VISION_MODEL", "deepseek-v4-flash-vision-exp")

# ---- OCR 配置 ----
OCR_DPI = int(os.getenv("OCR_DPI", "300"))
# Apple Vision 语言偏好；逗号分隔。zh-Hans 简体 / zh-Hant 繁体 / en-US 英文
OCR_LANGUAGES = [x.strip() for x in os.getenv("OCR_LANGUAGES", "zh-Hans,zh-Hant,en-US").split(",") if x.strip()]
