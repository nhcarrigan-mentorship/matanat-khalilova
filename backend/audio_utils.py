import os
import re

import httpx
from groq import Groq

from database import db

# Initialize the Groq client using your environment variable
try:
    groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
except Exception as e:
    print(f"Failed to initialize Groq Client: {e}")
    groq_client = None

WHISPER_MODEL = "whisper-large-v3-turbo"


async def transcribe_audio_bytes(
    audio_bytes: bytes, filename: str = "sample.wav"
) -> str:
    """
    Takes raw audio bytes from the database, sends them to Groq Whisper,
    and returns the transcribed text string.
    """
    if not groq_client:
        raise RuntimeError("Groq client is not initialized. Check your GROQ_API_KEY.")

    try:
        # We pass a tuple (filename, bytes) to simulate an actual file upload
        transcription = groq_client.audio.transcriptions.create(
            file=(filename, audio_bytes),
            model=WHISPER_MODEL,
            temperature=0,  # 0 means deterministic, keeping it highly accurate
            response_format="verbose_json",
        )
        return transcription.text
    except Exception as e:
        print(f"Groq Whisper transcription error: {e}")
        raise e


async def process_voice_profile_training(user_id: str) -> dict:
    """
    1. Fetches all 15 validated voice samples for the user.
    2. Downloads their raw audio files from Cloudinary.
    3. Transcribes them with Groq Whisper.
    4. Compares 'text' vs 'whisper_text' to build a correction prompt.
    """
    # 1: Fetch all validated samples for this user
    cursor = db.voice_samples.find({"user_id": user_id, "is_validated": True})
    samples = await cursor.to_list(length=20)

    if not samples:
        raise ValueError("No validated samples found for this user.")

    correction_map = {}

    """
    Initialize a reusable async HTTP client for downloading
    audio files from Cloudinary
    """
    async with httpx.AsyncClient() as client:
        for sample in samples:
            original_text = sample.get("text")
            audio_url = sample.get("audio_url")

            if not audio_url:
                print(f"Sample {sample['_id']} has no audio URL, skipping.")
                continue
            try:
                # 2. Download the audio file from Cloudinary into memory(RAM)
                response = await client.get(audio_url)
                if response.status_code != 200:
                    print(
                        f"Failed to download audio for sample {sample['_id']}, "
                        f"status code: {response.status_code}"
                    )
                    continue

                audio_bytes = response.content  # our raw in-memory binary data

                # 3. Send file bytes to Groq Whisper for transcription
                whisper_text = await transcribe_audio_bytes(
                    audio_bytes, filename=f"sample_{sample['_id']}.wav"
                )

                original_words = re.findall(r"\b\w+\b", original_text.lower())
                whisper_words = re.findall(r"\b\w+\b", whisper_text.lower())

                if len(original_words) == len(whisper_words):
                    for w_word, o_word in zip(whisper_words, original_words):
                        if w_word != o_word:
                            correction_map[w_word] = o_word

            except Exception as e:
                print(f"Skipping sample {sample['_id']} due to error: {e}")
                continue

    map_str = ", ".join(
        [f"replace '{k}' with '{v}'" for k, v in correction_map.items()]
    )
    correction_prompt = (
        f"The user has dysarthric speech patterns. "
        f"Apply these exact word substitutions: {map_str}"
        if map_str
        else ""
    )

    return {"correction_map": correction_map, "correction_prompt": correction_prompt}
