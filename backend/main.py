import io
import os
import re
import time
from collections import defaultdict
from datetime import datetime

import bcrypt
import cloudinary
import cloudinary.uploader
import numpy as np
import torch
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, field_validator
from pydub import AudioSegment

from audio_utils import process_voice_profile_training, transcribe_audio_bytes
from auth_utils import create_access_token, verify_access_token
from database import client, db, phrases_collection, users_collection

app = FastAPI()
router = APIRouter()

# Load environment variables from .env file
load_dotenv()

# Load the local Silero VAD model and utility function
models, utils = torch.hub.load(
    repo_or_dir="snakers4/silero-vad",
    model="silero_vad",
    force_reload=False,
    trust_repo=True,
)

(get_speech_timestamps, save_audio, read_audio, VADIterator, collect_chunks) = utils

cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
    secure=True,
)


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
        "is_trained": False,
        "is_optimized": False,
        "correction_prompt": "",
        "correction_map": {},
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
            "is_trained": user.get(
                "is_trained", False
            ),  # 15/15 sample recorded and validated
            "is_optimized": user.get("is_optimized", False),  # Whisper patterns mapped
            "correction_prompt": user.get(
                "correction_prompt", ""
            ),  # The generated correction prompt for Whisper
            "correction_map": user.get(
                "correction_map", {}
            ),  # The generated correction map for Whisper
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
    phrases_cursor = phrases_collection.find().sort(
        "id", 1
    )  # Sorts them 1 to 15; also adjust length as needed
    phrases_list = await phrases_cursor.to_list(length=100)

    for phrase in phrases_list:
        phrase["_id"] = str(phrase["_id"])

    return {"status": "success", "count": len(phrases_list), "phrases": phrases_list}


@app.post("/api/upload-audio")
async def upload_audio(
    file: UploadFile = File(...),
    phrase_id: str = Form(...),  # Catch the phrase ID from the frontend
    current_user: dict = Depends(get_current_user),
):
    try:
        actual_user_id = current_user["user"]["id"]

        # Basic server-side validation (size check)
        # Ensure the file is not effectively empty
        file_content = await file.read()
        if len(file_content) < 1000:
            return {
                "status": "error",
                "message": "Uploaded file is too small or empty. Please try again.",
            }
        # Reset file pointer after reading for Cloudinary
        file.file.seek(0)
        # Send to Cloudinary
        result = cloudinary.uploader.upload(
            file.file,
            resource_type="video",
            folder=f"user_recordings/{actual_user_id}",
            public_id=f"phrase_{phrase_id}",
            overwrite=True,
            invalidate=True,
        )
        audio_url = result.get("secure_url")
        # Save the link to MONGODB

        await db.voice_samples.update_one(
            {"user_id": actual_user_id, "phrase_id": phrase_id},
            {
                "$set": {
                    "audio_url": audio_url,
                    "is_validated": True,
                    "validation_error": None,
                    "created_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )
        sample_count = await db.voice_samples.count_documents(
            {"user_id": actual_user_id, "is_validated": True}
        )

        if sample_count >= 15:
            await users_collection.update_one(
                {"_id": ObjectId(actual_user_id)},
                {"$set": {"is_trained": True}},
            )

        return {"status": "success", "url": audio_url, "count": sample_count}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/my-recordings")
async def get_user_recordings(current_user: dict = Depends(get_current_user)):
    try:
        # 1. Get the ID of the logged-in user
        actual_user_id = current_user["user"]["id"]

        # 2. Find all samples where user_id matches
        # We sort by created_at so they appear in order
        cursor = db.voice_samples.find({"user_id": actual_user_id}).sort("phrase_id", 1)
        samples = await cursor.to_list(length=100)

        # 3. Clean up MongoDB ObjectIDs for React
        for sample in samples:
            sample["_id"] = str(sample["_id"])
            # Get the phrase_id from the sample
            p_id = sample.get("phrase_id")

            if p_id:
                try:
                    # Try to find the phrase using ObjectId
                    # (using str(p_id) to handle string from database)
                    phrase_doc = await phrases_collection.find_one(
                        {"_id": ObjectId(str(p_id))}
                    )

                    if phrase_doc:
                        sample["text"] = phrase_doc.get(
                            "text", "Text field missing in phrase doc"
                        )
                    else:
                        # Fallback: If it's not an ObjectId in the phrases collection,
                        # try searching a plain string
                        phrase_doc_alt = await phrases_collection.find_one(
                            {"_id": str(p_id)}
                        )
                        if phrase_doc_alt:
                            sample["text"] = phrase_doc_alt.get("text")
                        else:
                            sample["text"] = f"Phrase {p_id} not found"
                except Exception as e:
                    sample["text"] = f"Error matching ID: {str(e)}"
            else:
                sample["text"] = "No phrase_id linked"

        return {"status": "success", "count": len(samples), "recordings": samples}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/train-profile")
async def train_profile(current_user: dict = Depends(get_current_user)):
    try:
        # The logged-in user's ID
        actual_user_id = current_user["user"]["id"]

        """Running the Cloudinary download -> Groq Whisper transcription
        to generate the correction maps"""
        training_results = await process_voice_profile_training(actual_user_id)

        # Updating the user's profile documents with the new AI mappings
        await db.users.update_one(
            {"_id": ObjectId(actual_user_id)},
            {
                "$set": {
                    "correction_map": training_results["correction_map"],
                    "correction_prompt": training_results["correction_prompt"],
                    "has_patterns": training_results["has_patterns"],
                    "is_optimized": True,
                }
            },
        )
        # Return the training results to the frontend to update the UI accordingly
        return {
            "status": "success",
            "message": "Voice profile training completed successfully!",
            "data": {
                "is_optimized": True,
                "has_patterns": training_results["has_patterns"],
                "mapped_words_count": len(training_results["correction_map"]),
            },
        }
    except ValueError as val_err:
        # Catches the specific "No validated samples found for this user." error
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as e:
        print(f"Error during profile training endpoint execution: {e}")
        raise HTTPException(
            status_code=500, detail="Internal server error during profile training."
        )


@app.get("/api/voice-profile/status")
async def get_profile_status(current_user: dict = Depends(get_current_user)):
    try:
        actual_user_id = current_user["user"]["id"]
        profile = await users_collection.find_one({"_id": ObjectId(actual_user_id)})

        if profile and profile.get("is_optimized") is True:
            return {
                "is_optimized": True,
                "has_patterns": profile.get("has_patterns", False),
            }

    except (KeyError, TypeError) as e:
        print(f"Auth structure lookup mismatch: {e}")
    except Exception as e:
        print(f"Database error tracking profile status: {e}")

    # Fallback default if they aren't optimized or if something fails
    return {"is_optimized": False, "has_patterns": False}


# Simple global in-memory tracking dictionary (Reset when server restarts)
# Structure: { user_id: [timestamp1, timestamp2, ...] }
USER_REQUEST_LOGS = defaultdict(list)

# Define limits: Max 5 requests every 10 seconds
RATE_LIMIT_WINDOW_SECONDS = 10
MAX_REQUESTS_PER_WINDOW = 5


@app.post("/api/translate/instant")
async def consecutive_translation(
    audio_file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    actual_user_id = current_user["user"]["id"]
    current_time = time.time()

    # Security/Permissions: Rate Limiting Enforcement
    # Clear out timestamps older than our threshold window
    USER_REQUEST_LOGS[actual_user_id] = [
        ts
        for ts in USER_REQUEST_LOGS[actual_user_id]
        if current_time - ts < RATE_LIMIT_WINDOW_SECONDS
    ]

    # Check if user has exceeded the safety threshold quota
    if len(USER_REQUEST_LOGS[actual_user_id]) >= MAX_REQUESTS_PER_WINDOW:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please wait a moment before recording again.",
        )

    # Log the valid request timestamp
    USER_REQUEST_LOGS[actual_user_id].append(current_time)

    try:
        if not audio_file.filename.endswith((".wav", ".mp3", ".m4a", ".webm")):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported file type. Please upload a valid audio file.",
            )
        # 1. Read the raw binary audio data from the frontend upload
        audio_bytes = await audio_file.read()
        # 2. Forward it to the Groq Whisper API for raw transcription
        raw_transcription = await transcribe_audio_bytes(
            audio_bytes, filename=audio_file.filename
        )
        # 3. Query MongoDB for this authenticated user's profile correction_prompt
        user_profile = await users_collection.find_one(
            {"_id": ObjectId(actual_user_id)}
        )

        if not user_profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="User profile not found"
            )

        # Extract the correction prompt rules from the user's profile
        correction_prompt = user_profile.get("correction_prompt", "")
        # 4. If prompt exists, send (Raw Text + Prompt) to Llama-3.1-8b-instant
        if correction_prompt and correction_prompt.strip():
            from audio_utils import groq_client

            user_content = (
                f"SPEECH PROFILE RULES:\n{correction_prompt}\n\n"
                f"RAW TRANSCRIPTION:\n{raw_transcription}"
            )

            llm_response = groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are an AI Assistive Speech Refiner. "
                            "Your job is to correct transcription errors "
                            "based STRICTLY on the user's custom speech profile rules. "
                            "Fix stuttering, misheard terminology, "
                            "or context errors as defined by the rules. "
                            "Keep the final text natural. Return ONLY the "
                            "corrected text string and nothing else—no pleasantries, "
                            "no conversational responses."
                        ),
                    },
                    {
                        "role": "user",
                        "content": user_content,
                    },
                ],
                temperature=0.2,  # Low temperature for more deterministic corrections
            )
            corrected_text = llm_response.choices[0].message.content.strip()
        else:
            # If no correction prompt is set up, just return the raw transcription
            corrected_text = raw_transcription
        # 5. Return the final corrected text string to the frontend
        return {
            "status": "success",
            "raw_transcription": raw_transcription,
            "corrected_text": corrected_text,
        }
    except HTTPException:
        # Let FastAPI's intentional HTTPExceptions bypass the catch-all block
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error processing audio translation: {str(e)}",
        )


def decode_audio_buffer(buffer_bytes: bytearray) -> np.ndarray:
    """
    Takes raw WebM audio bytes from the memory buffer,
    decodes them via ffmpeg,
    and returns a normalized Float32 numpy array at 16kHz Mono.
    """

    if len(buffer_bytes) == 0:
        return np.array([], dtype=np.float32)

    try:
        # Wrap the raw bytes in an in-memory file-like object
        audio_file = io.BytesIO(buffer_bytes)

        # Use pydub (driven by ffmpeg) to read the WebM container
        audio_segment = AudioSegment.from_file(audio_file, format="webm")

        # Enforce the exact constraints required by VAD/Whisper (16kHz, Mono)
        audio_segment = audio_segment.set_frame_rate(16000).set_channels(1)

        # Convert raw binary samples into a numpy numerical array
        samples = np.array(audio_segment.get_array_of_samples(), dtype=np.float32)

        # Normalize audio data from integers to floats between -1.0 and 1.0
        # (16-bit audio max amplitude is 32768)
        normalized_samples = samples / 32768.0

        return normalized_samples

    except Exception as e:
        print(f"Error decoding audio buffer layout: {str(e)}")
        return np.array([], dtype=np.float32)


@app.websocket("/api/stream")
async def websocket_endpoint(websocket: WebSocket):
    # Accept the incoming frontend connection request
    await websocket.accept()
    print("WebSocket Connection established successfully")

    # Initialize an empty bytearray to accumulate incoming audio chunks
    audio_buffer = bytearray()

    try:
        while True:
            # Wait for data to arrive over the socket line
            # For this test, we expect the frontend to send text strings
            data = await websocket.receive_bytes()

            # Append the new 2-second binary chunk to our master buffer
            audio_buffer.extend(data)

            # Test Decoding: Convert the current full buffer into raw numbers
            pcm_data = decode_audio_buffer(audio_buffer)

            print(
                f"Received chunk: {len(data)} bytes. "
                f"Master buffer total: {len(audio_buffer)} bytes. "
                f"Decoded PCM data points: {len(pcm_data)}"
            )

            # Echo the data back to the frontend to prove the bridge works
            await websocket.send_text(
                f"Server gathered chunk. Accumulator at {len(audio_buffer)} bytes. "
                f"Server decoded buffer into {len(pcm_data)} audio points."
            )
    except WebSocketDisconnect:
        print("Client disconnected from WebSocket safely")
    except Exception as e:
        print(f"Unexpected WebSocket error occurred: {str(e)}")
