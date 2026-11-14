"""사이트 접속 비밀번호처럼 되돌려 봐야 하는 값을 암호화해 저장하기 위한 도구.

키 파일(data/secret.key)이 없으면 처음 쓸 때 만든다. 키를 잃으면 암호화된 값은 복구할 수 없으므로
DB를 백업·이전할 때 키 파일도 함께 옮겨야 한다. (git 제외)
"""
import os
from cryptography.fernet import Fernet, InvalidToken

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KEY_PATH = os.path.join(BASE_DIR, "data", "secret.key")
PREFIX = "enc:v1:"

_fernet = None


def _get() -> Fernet:
    global _fernet
    if _fernet is None:
        if not os.path.exists(KEY_PATH):
            fd = os.open(KEY_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(Fernet.generate_key())
        with open(KEY_PATH, "rb") as f:
            _fernet = Fernet(f.read().strip())
    return _fernet


def is_encrypted(value) -> bool:
    return bool(value) and str(value).startswith(PREFIX)


def encrypt(text) -> str:
    """빈 값은 그대로 빈 값. 이미 암호화된 값은 다시 암호화하지 않는다."""
    if not text:
        return ""
    if is_encrypted(text):
        return text
    return PREFIX + _get().encrypt(str(text).encode()).decode()


def decrypt(value) -> str:
    """암호화 전 저장분(평문)은 그대로 돌려준다. 키가 맞지 않으면 ValueError."""
    if not value:
        return ""
    if not is_encrypted(value):
        return value
    try:
        return _get().decrypt(value[len(PREFIX):].encode()).decode()
    except InvalidToken:
        raise ValueError("암호화 키가 맞지 않아 값을 풀 수 없습니다")
