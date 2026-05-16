import os
from groq import Groq

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
