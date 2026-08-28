"""可公开的模型与 OCR 默认配置；API Key 不在配置模块中持久化。"""
import os

# ---- DeepSeek API ----
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
DEEPSEEK_CHAT_MODEL = os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-chat")
DEEPSEEK_VISION_MODEL = os.getenv("DEEPSEEK_VISION_MODEL", "deepseek-v4-flash-vision-exp")

# ---- OCR 配置 ----
OCR_DPI = int(os.getenv("OCR_DPI", "300"))
# Apple Vision 语言偏好；逗号分隔。zh-Hans 简体 / zh-Hant 繁体 / en-US 英文
OCR_LANGUAGES = [x.strip() for x in os.getenv("OCR_LANGUAGES", "zh-Hans,zh-Hant,en-US").split(",") if x.strip()]
