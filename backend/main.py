import re

import bcrypt
from bson import ObjectId
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, field_validator

from auth_utils import create_access_token, verify_access_token
from database import client, phrases_collection, users_collection

app = FastAPI()


@app.get("/")
def read_root():
    return {"message": "VoiceBridge API is live!"}


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000"
    ],  # set it to "https://www.voicebridge.com" in production
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


class UserLogin(BaseModel):
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
async def signup(user: UserSignup, response: Response):
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

    # 5. Create JWT token
    token = create_access_token(str(result.inserted_id))

    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        max_age=86400,  # 24 hours in seconds
        samesite="lax",  # Helps prevent CSRF attacks
        secure=False,  # Set to True while using https:// in production
    )

    return {
        "status": "success",
        "message": f"Account created for {user.email}",
        "user_id": str(result.inserted_id),
    }


@app.post("/api/auth/login")
async def login(response: Response, user: UserLogin):
    # 1. Find user by email
    existing_user = await users_collection.find_one({"email": user.email})
    if not existing_user:
        raise HTTPException(
            status_code=400,
            detail="This email is not registered. Please sign up first.",
        )
    # 2. Verify password
    password_bytes = user.password.encode("utf-8")
    stored_hashed_password = existing_user["password"].encode("utf-8")
    if not bcrypt.checkpw(password_bytes, stored_hashed_password):
        raise HTTPException(status_code=400, detail="Invalid email or password")
    # 3. Create JWT token
    token = create_access_token(str(existing_user["_id"]))

    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        max_age=86400,  # 24 hours in seconds
        samesite="lax",  # Helps prevent CSRF attacks
        secure=False,  # Set to True while using https:// in production
    )

    return {
        "status": "success",
        "message": f"Welcome back, {existing_user['name']}!",
        "user_id": str(existing_user["_id"]),
    }


@app.get("/api/auth/me")
async def get_current_user(request: Request):
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # Verify token and get user ID
    user_id = verify_access_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    # Look up user in database
    user = await users_collection.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Return the user data (don't send password back)
    return {
        "status": "success",
        "user": {
            "id": str(user["_id"]),
            "email": user["email"],
            "name": user["name"],
        },
    }


@app.post("/api/auth/logout")
async def logout(response: Response):
    response.delete_cookie(
        key="access_token",
        httponly=True,
        samesite="lax",
        secure=False,  # Set to True while using https:// in production
    )
    return {"status": "success", "message": "Logged out successfully"}


@app.get("/api/phrases")
async def get_phrases():
    phrases_cursor = phrases_collection.find()
    phrases_list = await phrases_cursor.to_list(length=100).sort(
        "id", 1
    )  # Sorts them 1 to 15; also adjust length as needed

    for phrase in phrases_list:
        phrase["_id"] = str(phrase["_id"])

    return {"status": "success", "count": len(phrases_list), "phrases": phrases_list}
