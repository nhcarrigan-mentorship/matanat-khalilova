import os
from datetime import datetime, timedelta, timezone

import jwt
from dotenv import load_dotenv

load_dotenv()

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")


def create_access_token(user_id: str):
    expire = datetime.now(timezone.utc) + timedelta(hours=24)

    payload = {
        "sub": user_id,
        "exp": expire,
    }

    encoded_jwt = jwt.encode(payload, JWT_SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt
