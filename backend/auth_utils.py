import os
from datetime import datetime, timedelta, timezone

import jwt
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import HTTPException
from starlette.requests import HTTPConnection

from database import users_collection

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


def verify_access_token(token: str):
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
        return user_id
    except jwt.PyJWTError:
        return None


async def get_current_user_auth(connection: HTTPConnection):
    token = connection.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user_id = verify_access_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await users_collection.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "status": "success",
        "user": {
            "id": str(user["_id"]),
            "email": user["email"],
            "name": user["name"],
            "is_trained": user.get("is_trained", False),
            "is_optimized": user.get("is_optimized", False),
            "correction_prompt": user.get("correction_prompt", ""),
            "correction_map": user.get("correction_map", {}),
        },
    }
