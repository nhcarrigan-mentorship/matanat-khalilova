import io
import os
import re
import time
import uuid
import wave
from collections import defaultdict
from datetime import datetime, timezone

import bcrypt
import cloudinary
import cloudinary.uploader
import edge_tts
import numpy as np
import torch
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, field_validator
from silero_vad import VADIterator, load_silero_vad

from audio_utils import (
    process_voice_profile_training,
    refine_transcription,
    transcribe_audio_bytes,
)
from auth_utils import create_access_token, get_current_user_auth
from database import client, db, phrases_collection, users_collection

app = FastAPI()
router = APIRouter()

load_dotenv()

VAD_MODEL = load_silero_vad()

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
        "http://localhost:3000",
        "https://voicebridge.app-pages.workers.dev",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check(response: Response):
    try:
        await client.admin.command("ping")
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        print(f"HEALTH CHECK ERROR: {e}")
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "unhealthy", "database": "Connection failed"}


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


class UserLogin(BaseModel):
    email: EmailStr
    password: str


@app.post("/api/auth/signup")
async def signup(user: UserSignup):
    existing_user = await users_collection.find_one({"email": user.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    password_bytes = user.password.encode("utf-8")
    hashed_password = bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode("utf-8")

    new_user = {
        "name": user.name,
        "email": user.email,
        "password": hashed_password,
        "is_trained": False,
        "is_optimized": False,
        "correction_prompt": "",
        "correction_map": {},
    }

    result = await users_collection.insert_one(new_user)
    token = create_access_token(str(result.inserted_id))

    return {
        "status": "success",
        "message": f"Account created for {user.email}",
        "user_id": str(result.inserted_id),
        "token": token,  # token returned in body
    }


@app.post("/api/auth/login")
async def login(user: UserLogin):
    existing_user = await users_collection.find_one({"email": user.email})
    if not existing_user:
        raise HTTPException(
            status_code=400,
            detail="This email is not registered. Please sign up first.",
        )

    password_bytes = user.password.encode("utf-8")
    stored_hashed_password = existing_user["password"].encode("utf-8")
    if not bcrypt.checkpw(password_bytes, stored_hashed_password):
        raise HTTPException(status_code=400, detail="Invalid email or password")

    token = create_access_token(str(existing_user["_id"]))

    return {
        "status": "success",
        "message": f"Welcome back, {existing_user['name']}!",
        "user_id": str(existing_user["_id"]),
        "token": token,  # token returned in body
    }


@app.get("/api/auth/me")
async def get_current_user_profile(current_user: dict = Depends(get_current_user_auth)):
    return {
        "status": "success",
        "user": current_user["user"],
    }


@app.post("/api/auth/logout")
async def logout():
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
                    "created_at": datetime.now(timezone.utc),
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
        print(f"CRITICAL ERROR: {e}")
        raise HTTPException(
            status_code=500,
            detail="An unexpected server error occurred. Please try again later.",
        )


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
                    print(f"PHRASE MATCHING ERROR for sample {sample['_id']}: {e}")
                    sample["text"] = "Error loading phrase text"
            else:
                sample["text"] = "No phrase_id linked"

        return {"status": "success", "count": len(samples), "recordings": samples}
    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
        raise HTTPException(
            status_code=500,
            detail="An unexpected server error occurred. Please try again later.",
        )


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
        import json

        try:
            # If it's our rich JSON error dictionary,
            # unpack it straight into the response
            error_payload = json.loads(str(val_err))
            raise HTTPException(status_code=400, detail=error_payload)
        except Exception:
            # Fallback for standard string ValueErrors
            # (Catches the specific "No validated samples found for this user." error)
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
        print(f"[DEBUG LOG] WHISPER RAW: '{raw_transcription}'")

        # 3. Query MongoDB for this authenticated user's profile correction_prompt
        user_profile = await users_collection.find_one(
            {"_id": ObjectId(actual_user_id)}
        )

        if not user_profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="User profile not found"
            )

        # Extract the correction map rules from the user's profile
        correction_map = user_profile.get("correction_map", {})
        corrected_text = await refine_transcription(raw_transcription, correction_map)
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
        print(f"CRITICAL ERROR: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing audio translation",
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
    websocket: WebSocket,
    token: str = Query(None),
):
    if not token:
        await websocket.close(code=4001, reason="Missing token")
        return

    from auth_utils import verify_access_token

    user_id = verify_access_token(token)
    if not user_id:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    user_profile = await users_collection.find_one({"_id": ObjectId(user_id)})
    if not user_profile:
        await websocket.close(code=4001, reason="User not found")
        return

    await websocket.accept()

    actual_user_id = str(user_profile["_id"])
    correction_map = user_profile.get("correction_map", {})

    vad_iterator = VADIterator(
        VAD_MODEL, sampling_rate=16000, threshold=0.4, min_silence_duration_ms=1000
    )  # Slightly lower threshold for crisp speech capture
    # threshold is a sensitivity setting for VAD ( how confident it's that it's speech)
    print("WebSocket Connection established successfully via raw PCM")

    # Initialize a local in-memory context storage for this specific stream
    session_history_segments = []

    master_pcm_stream = []
    vad_pointer = 0  # tracks how much data we've processed so far
    window_size = 512
    active_speech_start = None

    # Tracks accumulated silent samples
    consecutive_silence_samples = 0

    # Latency: a mic produces samples in real time, so sample N of this stream
    # was spoken at stream_start + N / 16000. That lets to measure from the
    # moment the user stopped speaking rather than from when we noticed
    stream_start = time.perf_counter()
    stream_offset = 0  # Samples already trimmed off the front of master_pcm_stream

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

                    print(f"[DEBUG LOG] FLUSH RAW WHISPER: '{raw_transcription}'")

                    clean_txt = raw_transcription.strip().lower().strip(".,!?")
                    banned_words = {
                        "thank you",
                        "thanks for watching",
                        "okay",
                        "ok",
                        "bye",
                    }

                    # Run it through the filter and LLM refinement
                    if clean_txt not in banned_words:
                        historical_context = " ".join(session_history_segments[-2:])
                        final_output = await refine_transcription(
                            raw_transcription=raw_transcription,
                            correction_map=correction_map,
                            history_context=historical_context,
                        )
                        if final_output.strip() and final_output.strip() != ".":
                            print(f"[DEBUG LOG] FLUSH LLM REFINED: '{final_output}'")
                            session_history_segments.append(final_output.strip())
                            await websocket.send_text(f"{final_output}")
                    else:
                        # Know when a hallucination was successfully blocked
                        print(f"Dropped flush hallucination: '{raw_transcription}'")

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
                    # Latency: wall-clock instant the user actually stopped talking
                    speech_end_perf = (
                        stream_start + (stream_offset + sentence_end) / 16000
                    )

                    wav_bytes = convert_raw_pcm_to_wav(current_sentence)
                    print(
                        f"Sending segment ({len(current_sentence)} samples) to Groq..."
                    )

                    transcribe_start = time.perf_counter()
                    raw_transcription = await transcribe_audio_bytes(
                        wav_bytes, filename=f"sentence_{actual_user_id}.wav"
                    )
                    transcribe_ms = (time.perf_counter() - transcribe_start) * 1000
                    print(f"[DEBUG LOG] WHISPER RAW: '{raw_transcription}'")

                    clean_txt = raw_transcription.strip().lower().strip(".,!?")
                    banned_words = {
                        "thank you",
                        "thanks for watching",
                        "okay",
                        "ok",
                        "bye",
                    }
                    # if there is no prior talk, whisper likely hallucinated
                    if clean_txt in banned_words and not session_history_segments:
                        print("Dropped silent hallucination anomaly.")
                        stream_offset += vad_pointer  # Keep the latency clock in sync
                        master_pcm_stream = master_pcm_stream[vad_pointer:]
                        vad_pointer = 0
                        active_speech_start = None
                        vad_iterator.reset_states()
                        continue

                    # Combine history list into a clean string context
                    historical_context = " ".join(session_history_segments[-2:])

                    refine_start = time.perf_counter()
                    final_output = await refine_transcription(
                        raw_transcription=raw_transcription,
                        correction_map=correction_map,
                        history_context=historical_context,
                    )
                    refine_ms = (time.perf_counter() - refine_start) * 1000
                    print(f"[DEBUG LOG] LLM REFINED: '{final_output}'")

                    if final_output.strip() and final_output.strip() != ".":
                        print(f"Live Output Sent: {final_output}")
                        session_history_segments.append(final_output.strip())
                        await websocket.send_text(f"{final_output}")

                        # Latency: speech end -> text on the wire. vad_lag is the
                        # 1s silence Silero waits out before calling the sentence
                        # over, and it is the floor of what we can achieve here.
                        total_ms = (time.perf_counter() - speech_end_perf) * 1000
                        vad_lag_ms = total_ms - transcribe_ms - refine_ms
                        print(
                            f"[LATENCY] total={total_ms:.0f}ms "
                            f"(vad_lag={vad_lag_ms:.0f}ms "
                            f"transcribe={transcribe_ms:.0f}ms "
                            f"refine={refine_ms:.0f}ms) "
                            f"{'OK' if total_ms <= 3000 else 'OVER 3s BUDGET'}"
                        )

                # Clear the entire evaluated window and drop pointers to 0
                # guarantees next loop iteration is perfectly 1:1 synced with Silero
                stream_offset += vad_pointer  # Keep the latency clock in sync
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


# Helper function to delete files after response is sent
def remove_file(path: str):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception as e:
        print(f"Failed to delete temporary file {path}: {e}")


# Roughly 15-20 minutes of speech. Far beyond any realistic single broadcast
MAX_TTS_CHARS = 15000


class TTSRequest(BaseModel):
    text: str


@app.post("/api/tts")
async def text_to_speech(
    payload: TTSRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user_auth),
):
    # POST with a JSON body rather than a query string: the text is not capped
    # by the ~8KB request-line limit, is not written to access logs, and is not
    # cached by proxies. It also lets the client send a bearer token.
    text = payload.text

    if not text.strip():
        raise HTTPException(status_code=400, detail="Text parameter cannot be empty")

    if len(text) > MAX_TTS_CHARS:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Text is too long to speak at once "
                f"({len(text)} characters, limit is {MAX_TTS_CHARS})."
            ),
        )

    unique_id = uuid.uuid4().hex
    output_filename = f"speech_{unique_id}.mp3"

    try:
        communicator = edge_tts.Communicate(text, "en-US-AriaNeural")
        await communicator.save(output_filename)

        background_tasks.add_task(remove_file, output_filename)

        return FileResponse(output_filename, media_type="audio/mp3")

    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
        raise HTTPException(status_code=500, detail="TTS Generation failed.")
