import io
import os
import re
import time
import wave
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
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, field_validator

from audio_utils import (
    process_voice_profile_training,
    refine_transcription,
    transcribe_audio_bytes,
)
from auth_utils import create_access_token, get_current_user_auth
from database import client, db, phrases_collection, users_collection

app = FastAPI()
router = APIRouter()

# Load environment variables from .env file
load_dotenv()

# Load the local Silero VAD model and utility function
# (This downloads the model on the first startup, then reads from cache)
VAD_MODEL, utils = torch.hub.load(
    repo_or_dir="snakers4/silero-vad",
    model="silero_vad",
    force_reload=False,
    trust_repo=True,
)

get_speech_timestamps, save_audio, read_audio, VADIterator, collect_chunks = utils

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
async def get_current_user_profile(current_user: dict = Depends(get_current_user_auth)):
    return {
        "status": "success",
        "user": current_user["user"],
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
    current_user: dict = Depends(get_current_user_auth),
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
async def get_user_recordings(current_user: dict = Depends(get_current_user_auth)):
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
async def train_profile(current_user: dict = Depends(get_current_user_auth)):
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
async def get_profile_status(current_user: dict = Depends(get_current_user_auth)):
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
    current_user: dict = Depends(get_current_user_auth),
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
        # 4. If prompt exists, send (Raw Text + Prompt) to LLM
        corrected_text = await refine_transcription(
            raw_transcription, correction_prompt
        )
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


def convert_raw_pcm_to_wav(pcm_array: np.ndarray) -> bytes:
    """Converts raw float32 PCM data directly into pristine WAV bytes for Groq"""
    # Force conversion to a true NumPy array immediately to guarantee .tobytes() exists
    pcm_array = np.asarray(pcm_array, dtype=np.float32)

    # Denormalize floats back to 16-bit integers (-32768 to 32767)
    int_samples = np.clip(pcm_array, -1.0, 1.0) * 32767.0
    int_samples = int_samples.astype(np.int16)

    wav_io = io.BytesIO()
    with wave.open(wav_io, "wb") as wav_file:  # wb means "write binary"
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 16-bit audio = 2 bytes per sample
        wav_file.setframerate(16000)  # 16kHz
        wav_file.writeframes(int_samples.tobytes())

    return wav_io.getvalue()


@app.websocket("/api/stream")
async def websocket_endpoint(
    websocket: WebSocket, current_user: dict = Depends(get_current_user_auth)
):
    await websocket.accept()
    vad_iterator = VADIterator(
        VAD_MODEL, sampling_rate=16000, threshold=0.4, min_silence_duration_ms=1000
    )  # Slightly lower threshold for crisp speech capture
    # threshold is a sensitivity setting for VAD ( how confident it's that it's speech)
    print("WebSocket Connection established successfully via raw PCM")

    # Initialize a local in-memory context storage for this specific stream
    session_history_segments = []

    actual_user_id = current_user["user"]["id"]
    user_profile = await users_collection.find_one({"_id": ObjectId(actual_user_id)})

    correction_prompt = ""
    if user_profile:
        correction_prompt = user_profile.get("correction_prompt", "").strip()

    master_pcm_stream = []
    vad_pointer = 0  # tracks how much data we've processed so far
    window_size = 512
    active_speech_start = None

    # Tracks accumulated silent samples
    consecutive_silence_samples = 0

    try:
        while True:
            data = await websocket.receive_bytes()

            if len(data) == 0:
                print("Frontend sent FINISH signal. Flushing leftover audio...")
                if len(master_pcm_stream) > 8000:  # At least ~0.5s of speech
                    current_sentence = np.array(master_pcm_stream, dtype=np.float32)
                    wav_bytes = convert_raw_pcm_to_wav(current_sentence)
                    raw_transcription = await transcribe_audio_bytes(
                        wav_bytes, filename=f"flush_{actual_user_id}.wav"
                    )

                    clean_txt = raw_transcription.strip().lower().strip(".,!?")
                    banned_words = {"thank you", "thanks for watching", "okay", "ok"}

                    # Run it through the filter and LLM refinement
                    if not (clean_txt in banned_words and not session_history_segments):
                        historical_context = " ".join(session_history_segments)
                        final_output = await refine_transcription(
                            raw_transcription=raw_transcription,
                            correction_prompt=correction_prompt,
                            history_context=historical_context,
                        )
                        if final_output.strip() and final_output.strip() != ".":
                            session_history_segments.append(final_output.strip())
                            await websocket.send_text(f"{final_output}")

                # Release the client safely
                await websocket.send_text("SYSTEM:FINISHED")
                break

            incoming_samples = np.frombuffer(data, dtype=np.float32)
            master_pcm_stream.extend(incoming_samples)

            sentence_detected = False
            sentence_end = 0

            # Step-by-step processing through our linear stream
            while vad_pointer + window_size <= len(master_pcm_stream):
                window = master_pcm_stream[vad_pointer : vad_pointer + window_size]

                speech_dict = vad_iterator(torch.from_numpy(np.array(window)))

                if speech_dict:
                    if "start" in speech_dict:
                        active_speech_start = speech_dict["start"]
                        print(
                            f"VAD: Human speech started at sample {active_speech_start}"
                        )

                    if "end" in speech_dict:
                        sentence_end = speech_dict["end"]
                        print(
                            f"VAD: Clean Human Pause Detected at sample {sentence_end}"
                        )
                        sentence_detected = True
                        vad_pointer += window_size
                        break

                # Count silence samples if no speech is actively happening
                if active_speech_start is None:
                    consecutive_silence_samples += window_size
                else:
                    consecutive_silence_samples = 0

                vad_pointer += window_size

            if sentence_detected:
                # Define a 300ms padding buffer (4800 samples at 16kHz)
                padding = 4800
                # If we missed the "start" token,
                # default safely to the beginning of the clear buffer
                slice_start = (
                    active_speech_start if active_speech_start is not None else 0
                )
                # Reach BACKWARD into the stream to catch
                # the initial consonant (like the 'g' in 'guys')
                slice_start = max(0, slice_start - padding)

                # Reach FORWARD into the stream to catch trailing
                # breaths or soft endings (like 'S')
                # Note: we use vad_pointer here because
                # sentence_end might cut off the trailing cushion
                slice_end = min(len(master_pcm_stream), sentence_end + padding)

                # Slice precisely from voice start to voice pause
                current_sentence = np.array(
                    master_pcm_stream[slice_start:slice_end], dtype=np.float32
                )

                if len(current_sentence) > 8000:
                    wav_bytes = convert_raw_pcm_to_wav(current_sentence)
                    print(
                        f"Sending segment ({len(current_sentence)} samples) to Groq..."
                    )

                    raw_transcription = await transcribe_audio_bytes(
                        wav_bytes, filename=f"sentence_{actual_user_id}.wav"
                    )
                    print(f"[DEBUG LOG] WHISPER RAW: '{raw_transcription}'")

                    clean_txt = raw_transcription.strip().lower().strip(".,!?")
                    banned_words = {
                        "thank you",
                        "thanks for watching",
                        "okay",
                        "ok",
                    }
                    # if there is no prior talk, whisper likely hallucinated
                    if clean_txt in banned_words and not session_history_segments:
                        print("Dropped silent hallucination anomaly.")
                        master_pcm_stream = master_pcm_stream[vad_pointer:]
                        vad_pointer = 0
                        active_speech_start = None
                        consecutive_silence_samples = 0
                        vad_iterator.reset_states()
                        continue

                    # Combine history list into a clean string context
                    historical_context = " ".join(session_history_segments)

                    final_output = await refine_transcription(
                        raw_transcription=raw_transcription,
                        correction_prompt=correction_prompt,
                        history_context=historical_context,
                    )
                    print(f"[DEBUG LOG] LLM REFINED: '{final_output}'")

                    if final_output.strip() and final_output.strip() != ".":
                        print(f"Live Output Sent: {final_output}")
                        session_history_segments.append(final_output.strip())
                        await websocket.send_text(f"{final_output}")

                # Clear the entire evaluated window and drop pointers to 0
                # guarantees next loop iteration is perfectly 1:1 synced with Silero
                master_pcm_stream = master_pcm_stream[vad_pointer:]
                vad_pointer = 0
                active_speech_start = None

                # Reset silence counter right after a sentence finishes processing
                consecutive_silence_samples = 0

                vad_iterator.reset_states()
                continue

            # 160,000 samples = 10 continuous seconds of silence
            # This runs only when no complete sentence was handled in this chunk cycle
            if consecutive_silence_samples >= 160000:
                print(
                    f"[AUTO-STOP] {consecutive_silence_samples} samples of silence. "
                    f"Winding down..."
                )
                await websocket.send_text("SYSTEM:AUTO_STOP")
                break

    except WebSocketDisconnect:
        print("Client disconnected from WebSocket safely")
    except Exception as e:
        print(f"Unexpected WebSocket error occurred: {str(e)}")
    finally:
        vad_iterator.reset_states()
