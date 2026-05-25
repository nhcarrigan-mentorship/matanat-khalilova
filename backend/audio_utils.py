import difflib
import os
import re

import httpx
from bson import ObjectId
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


def normalize_numerics(text: str) -> str:
    """
    Converts common digits into text words to prevent text-inversion bugs.
    """
    num_map = {
        "0": "zero",
        "1": "one",
        "2": "two",
        "3": "three",
        "4": "four",
        "5": "five",
        "6": "six",
        "7": "seven",
        "8": "eight",
        "9": "nine",
        "10": "ten",
        "11": "eleven",
        "12": "twelve",
        "13": "thirteen",
        "14": "fourteen",
        "15": "fifteen",
        "16": "sixteen",
        "17": "seventeen",
        "18": "eighteen",
        "19": "nineteen",
        "20": "twenty",
        "32": "thirty two",
        "33": "thirty three",
    }

    words = text.split()
    normalized_words = [num_map.get(word, word) for word in words]
    return " ".join(normalized_words)


def build_advanced_map(
    original_text: str, whisper_text: str, sample_id: str = "unknown"
) -> tuple[dict, float]:
    """
    Clean text to remove punctuation styling
    for cleaner matching strings
    """
    # [^\w\s] means "match any character that is NOT a word character or whitespace"
    o_clean = re.sub(r"[^\w\s]", "", original_text.lower()).strip()
    w_clean = re.sub(r"[^\w\s]", "", whisper_text.lower()).strip()

    # Force collapse internal double spaces before numeric normalization
    o_clean = " ".join(o_clean.split())
    w_clean = " ".join(w_clean.split())

    o_clean = normalize_numerics(o_clean)
    w_clean = normalize_numerics(w_clean)

    original_words = o_clean.split()
    whisper_words = w_clean.split()

    print(
        f"Words Expected Count: {len(original_words)}\n"
        f"Words Heard Count: {len(whisper_words)}"
    )

    matcher = difflib.SequenceMatcher(None, whisper_words, original_words)
    match_ratio = matcher.ratio()
    """
    The safety Guardrail:
    If the strings match less than 35%,
    Whisper hallucinated or audio was junk, skip mapping for this sample
    """
    if match_ratio < 0.35:
        print(
            f"Low match ratio ({match_ratio:.2f})."
            f"Skipping hallucination "
            f"for sample {sample_id}."
        )
        return {}, match_ratio
    phrase_map = {}

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "replace":
            w_chunk = whisper_words[i1:i2]
            o_chunk = original_words[j1:j2]

            if len(w_chunk) == len(o_chunk):
                for w_word, o_word in zip(w_chunk, o_chunk):
                    if w_word != o_word:
                        phrase_map[w_word] = o_word

            elif len(w_chunk) > 0 and len(o_chunk) > 0:
                w_phrase = " ".join(w_chunk)
                o_phrase = " ".join(o_chunk)
                if w_phrase != o_phrase:
                    phrase_map[w_phrase] = o_phrase

    return phrase_map, match_ratio


async def process_voice_profile_training(user_id: str) -> dict:
    """
    1. Fetches all 15 validated voice samples for the user.
    2. Downloads their raw audio files from Cloudinary.
    3. Transcribes them with Groq Whisper.
    4. Compares 'text' ('original_text') vs 'whisper_text' to build a correction prompt.
    """
    # 1. Fetch all validated samples for this user
    cursor = db.voice_samples.find({"user_id": user_id, "is_validated": True})
    samples = await cursor.to_list(length=20)

    if not samples:
        raise ValueError("No validated samples found for this user.")

    master_correction_map = {}
    successful_matches_count = 0

    """
    Initialize a reusable async HTTP client for downloading
    audio files from Cloudinary
    """
    async with httpx.AsyncClient() as client:
        for sample in samples:
            phrase_doc = await db.phrases.find_one(
                {"_id": ObjectId(sample.get("phrase_id"))}
            )
            original_text = phrase_doc.get("text") if phrase_doc else ""
            if not original_text:
                print(
                    f"Warning: No matching phrase text found for phrase_id "
                    f"{sample.get('phrase_id')}"
                )
                continue
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

                print("\n--- AI PIPELINE DIAGNOSTIC ---")
                print(f"Phrase ID: {sample.get('phrase_id')}")
                print(f"EXPECTED TRUTH: '{original_text}'")
                print(f"WHISPER HEARD:  '{whisper_text}'")

                # 4. Call the external function to build correction map for the sample
                sample_map, match_ratio = build_advanced_map(
                    original_text, whisper_text, str(sample["_id"])
                )

                if match_ratio < 0.35:
                    print(
                        f"Sample {sample['_id']} failed quality check "
                        f"(Ratio: {match_ratio:.2f})."
                    )
                    print("Not counting toward calibration matrix.")
                    continue

                master_correction_map.update(sample_map)
                successful_matches_count += 1

            except Exception as e:
                print(f"Skipping sample {sample['_id']} due to error: {e}")
                continue

    if successful_matches_count < 10:
        raise ValueError(
            f"Training failed. Audio quality was too low across your recordings. "
            f"Only {successful_matches_count}/{len(samples)} samples passed validation."
            f" Please check your voice profile and re-record your low-quality clips."
        )

    map_str = ", ".join(
        [f"replace '{k}' with '{v}'" for k, v in master_correction_map.items()]
    )
    correction_prompt = (
        f"You are a speech correction assistant for a user with dysarthric speech. "
        f"Whisper speech recognition consistently mishears this specific user. "
        f"Below are known patterns where the left side is what Whisper heard "
        f"and the right side is what the user actually meant: {map_str}. "
        f"When given a raw Whisper transcription, use these patterns AND contextual "
        f"reasoning to rewrite it as natural, grammatically correct English. "
        f"If a word sounds phonetically similar to a known pattern, "
        f"apply the correction. "
        f"Preserve the user's intended meaning above all else. "
        f"Return only the corrected text, nothing else."
    )

    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {
            "$set": {
                "is_optimized": True,
                "correction_map": master_correction_map,
                "correction_prompt": correction_prompt,
            }
        },
    )

    return {
        "correction_map": master_correction_map,
        "correction_prompt": correction_prompt,
    }
