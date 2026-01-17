import re

import bcrypt
from fastapi import FastAPI
from pydantic import BaseModel, EmailStr, field_validator

app = FastAPI()


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


@app.get("/")
def home():
    return {"message": "Welcome to the VoiceBridge Backend!"}


@app.post("/api/auth/signup")
async def signup(user: UserSignup):

    password_bytes = user.password.encode("utf-8")
    hashed_password = bcrypt.hashpw(password_bytes, bcrypt.gensalt())

    print(f"User email: {user.email}")
    print(f"Hashed password: {hashed_password}")

    return {
        "status": "success",
        "message": (f"Account created for {user.email}. Password has been hashed!"),
    }
