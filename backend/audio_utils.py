import difflib
import json
import os
import re

import httpx
from bson import ObjectId
from groq import AsyncGroq

from database import db

# Initialize the Groq client using your environment variable
try:
    groq_client = AsyncGroq(api_key=os.environ.get("GROQ_API_KEY"))
except Exception as e:
    print(f"Failed to initialize Groq Client: {e}")
    groq_client = None

WHISPER_MODEL = "whisper-large-v3-turbo"
FORMATTING_MODEL = "openai/gpt-oss-20b"


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
        transcription = await groq_client.audio.transcriptions.create(
            file=(filename, audio_bytes),
            model=WHISPER_MODEL,
            temperature=0,  # 0 means deterministic, keeping it highly accurate
            language="en",
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

    text_modified = text
    # loop through the map and replace digits using word boundaries (\b)
    for num_str, word_str in num_map.items():
        pattern = re.compile(r"\b" + re.escape(num_str) + r"\b")
        text_modified = pattern.sub(word_str, text_modified)

    return text_modified


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
    failed_phrase_ids = []

    """
    Initialize a reusable async HTTP client for downloading
    audio files from Cloudinary
    """
    async with httpx.AsyncClient() as client:
        for sample in samples:
            phrase_doc = await db.phrases.find_one(
                {"_id": ObjectId(sample.get("phrase_id"))}
            )

            p_id = phrase_doc.get("id") if phrase_doc else None

            original_text = phrase_doc.get("text") if phrase_doc else ""
            if not original_text:
                print(
                    f"Warning: No matching phrase text found for phrase_id "
                    f"{sample.get('phrase_id')}"
                )
                if p_id is not None:
                    failed_phrase_ids.append(p_id)  # Track skip
                continue
            audio_url = sample.get("audio_url")

            if not audio_url:
                print(f"Sample {sample['_id']} has no audio URL, skipping.")
                if p_id is not None:
                    failed_phrase_ids.append(p_id)  # Track skip
                continue
            try:
                # 2. Download the audio file from Cloudinary into memory(RAM)
                response = await client.get(audio_url)
                if response.status_code != 200:
                    print(
                        f"Failed to download audio for sample {sample['_id']}, "
                        f"status code: {response.status_code}"
                    )
                    if p_id is not None:
                        failed_phrase_ids.append(p_id)  # Track skip
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
                    if p_id is not None:
                        failed_phrase_ids.append(p_id)  # Track skip
                    continue

                master_correction_map.update(sample_map)
                successful_matches_count += 1

            except Exception as e:
                print(f"Skipping sample {sample['_id']} due to error: {e}")
                if p_id is not None:
                    failed_phrase_ids.append(p_id)  # Track skip
                continue

    if successful_matches_count < 10:
        raise ValueError(
            json.dumps(
                {
                    "message": (
                        "Training failed. Audio quality was too low across "
                        "your recordings. Only "
                        f"{successful_matches_count}/{len(samples)} "
                        "samples passed validation. Please check your voice "
                        "profile and re-record your low-quality clips."
                    ),
                    "failed_ids": failed_phrase_ids,
                }
            )
        )

    # Initialize defaults
    correction_prompt = ""

    # Only compile patterns if mistakes were actually found
    if master_correction_map:
        map_str = ", ".join(
            [f"replace '{k}' with '{v}'" for k, v in master_correction_map.items()]
        )

        correction_prompt = (
            f"USER SPEECH PROFILE:\n- Known Whisper Mishearing Dictionary:\n{map_str}"
        )

    return {
        "is_optimized": True,
        "has_patterns": len(master_correction_map) > 0,
        "correction_map": master_correction_map,
        "correction_prompt": correction_prompt,
    }


def apply_deterministic_substitutions(raw_text: str, correction_map: dict) -> str:
    """
    Executes precise word/phrase mappings locally via Python regex patterns.
    Preserves structural casing (Capitalized, UPPERCASE, lowercase) dynamically.
    """
    if not correction_map or not raw_text.strip():
        return raw_text

    refined_text = raw_text
    # Sort keys by length descending to process longer phrases before individual words
    sorted_keys = sorted(correction_map.keys(), key=len, reverse=True)
    for word in sorted_keys:
        replacement = correction_map[word]
        # Using word boundaries (\b) ensures
        # we match distinct words/phrases instead of word parts
        pattern = re.compile(r"\b" + re.escape(word) + r"\b", re.IGNORECASE)

        def match_case(match):
            matched_text = match.group(0)
            if matched_text.isupper():
                return replacement.upper()
            if matched_text and matched_text[0].isupper():
                return replacement.capitalize()
            return replacement.lower()

        refined_text = pattern.sub(match_case, refined_text)

    return refined_text


async def refine_transcription(
    raw_transcription: str, correction_map: dict, history_context: str = ""
) -> str:
    """
    Pipeline Step 1: Normalize digit variations (e.g., '2' -> 'two')
    Pipeline Step 2: Modifies raw input string using local Python dictionary regex
    Pipeline Step 3: Formats capitalization and punctuation via Llama-3.1-8b
    Pipeline Step 4: Guardrail validates that vocabulary matches 100%
    """
    if not raw_transcription.strip():
        return raw_transcription

    normalized_text = normalize_numerics(raw_transcription)
    if correction_map:
        substituted_text = apply_deterministic_substitutions(
            normalized_text, correction_map
        )
    else:
        substituted_text = normalized_text

    print(f"[DEBUG LOG] POST-PYTHON SUB: '{substituted_text}'")

    if not groq_client:
        return substituted_text

    system_message = (
        "You are a strict syntax and formatting assistant. "
        "Your ONLY job is to apply proper capitalization and "
        "punctuation to the text provided inside the <text_to_format> tags.\n\n"
        "YOUR LAWS:\n"
        "1. Insert proper syntax punctuation (periods, "
        "commas, question marks, apostrophes).\n"
        "2. Adjust basic word capitalization contextually "
        "(start of sentences, proper nouns).\n"
        "3. CRITICAL HISTORY RULE: The text inside <conversation_history> "
        "(if any) is ONLY for context to help you understand sentence flow "
        "(e.g., if the target text starts mid-sentence). NEVER include, "
        "repeat, copy, prefix, or append any words or sentences from "
        "<conversation_history> into your final output. Your output must "
        "contain ONLY the formatted version of the words "
        "found inside <text_to_format>.\n"
        "4. CRITICAL UNTOUCHABLE RULE: Do NOT change, add, swap, "
        "correct, or delete any words from <text_to_format>. Even if "
        "a phrase sounds completely unnatural, repetitive, grammatically "
        "incorrect, or nonsensical (such as repeating 'each and each'), "
        "you MUST leave the vocabulary 100% identical to the input. "
        "Never 'fix' expressions, typos, or idioms.\n"
        "5. OUTPUT RESTRICTION: Return ONLY the final processed text "
        "string belonging to <text_to_format>. Absolutely zero conversational "
        "explanations, and do not repeat or include the XML tags themselves."
    )

    user_content = (
        f"<conversation_history>{history_context}</conversation_history>\n"
        f"<text_to_format>{substituted_text}</text_to_format>"
    )

    try:
        llm_response = await groq_client.chat.completions.create(
            model=FORMATTING_MODEL,
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_content},
            ],
            temperature=0.0,  # Strict determinism
        )
        llm_text = llm_response.choices[0].message.content.strip()
        print(f"[DEBUG LOG] LLM refined: '{llm_text}'")

        words_expected = re.sub(r"[^\w\s]", "", substituted_text.lower()).split()
        words_received = re.sub(r"[^\w\s]", "", llm_text.lower()).split()

        # If the word sequences match perfectly, return the LLM text
        if words_expected == words_received:
            return llm_text

        # If the LLM altered any words, catch it, drop it and fallback safely
        print("\n[GUARDRAIL] LLM altered target vocabulary")
        print(f"Expected: {words_expected}")
        print(f"Received: {words_received}\n")
        return substituted_text

    except Exception as e:
        print(f"Groq LLM formatting pipeline exception: {e}")
        return substituted_text


# TODO: Future enhancement — phonetic matching using jellyfish
# library to catch variations like "suada" vs "suadi" mapping
# to same correction. Current map requires exact word match.
