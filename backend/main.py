import re

import bcrypt
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, field_validator

from database import client, users_collection

app = FastAPI()


@app.get("/")
def read_root():
    return {"message": "VoiceBridge API is live!"}


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    try:
        await client.admin.command("ping")
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "database": str(e)}


class UserSignup(BaseModel):
    name: str
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        if not re.search(r"\d", v):
            raise ValueError("Password must contain at least one digit")
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', v):
            raise ValueError("Password must contain at least one special character")
        return v


@app.post("/api/auth/signup")
async def signup(user: UserSignup):
    # 1. Check if user already exists
    existing_user = await users_collection.find_one({"email": user.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # 2. Hash the password
    password_bytes = user.password.encode("utf-8")
    hashed_password = bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode("utf-8")

    # 3. Create user document
    new_user = {
        "name": user.name,
        "email": user.email,
        "password": hashed_password,  # Save the hash, not the plain text password
    }

    # 4. Save to MongoDB
    result = await users_collection.insert_one(new_user)

    return {
        "status": "success",
        "message": f"Account created for {user.email}",
        "user_id": str(result.inserted_id),
    }
