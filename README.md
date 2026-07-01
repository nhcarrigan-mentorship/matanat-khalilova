# 🎙️ VoiceBridge

An AI-powered communication tool that transforms dysarthric or
difficult-to-understand speech into clear, natural-sounding audio
in real time — giving users with speech impairments their digital
voice back.

## Features

- **Voice Profile Training** — Record 15 voice samples to calibrate
  the app to your unique speech patterns.
- **Smart Training Validation** — Automatic audio quality checks
  ensure only clean samples are used for training.
- **Voice Pattern Training** — Builds a personalized correction
  map using Groq Whisper and difflib pattern matching.
- **AI Speech Correction Pipeline** — Whisper transcribes raw audio,
  a Python correction engine replaces atypical speech patterns using
  your personal speech profile, then an LLM refines punctuation and
  capitalization for natural readability.
- **Single Take Mode** — Record a complete train of thought and receive the full transcription once you finalize.
- **Continuous Streaming Mode** — Live transcription that appears
  on screen in real time as you speak.
- **Text-to-Speech Output** — Natural-sounding voice output via
  edge-tts neural voices.

## Live Demo

[voicebridge.app-pages.workers.dev](https://voicebridge.app-pages.workers.dev)

## Technologies Used

- **React** — Frontend
- **Python + FastAPI** — Backend
- **MongoDB Atlas** — Database
- **Groq Whisper Large v3 Turbo** — Speech-to-Text
- **GPT OSS 20B via Groq** — LLM post-processing
- **edge-tts** — Text-to-Speech
- **Silero VAD** — Voice Activity Detection for real-time sentence boundary detection
- **Cloudinary** — Audio storage
- **WebSockets** — Real-time streaming
- **Cloudflare Workers** — Frontend deployment
- **Render** — Backend deployment
- **GitHub Actions** — CI/CD

## Installation & Setup

Follow these steps to get your local development environment running.

### Prerequisites

- **Node.js** — Version 18.x or higher
- **npm** — Included with Node.js
- **Python** — Version 3.10+
- **MongoDB Atlas** — Free account at cloud.mongodb.com
- **Groq API Key** — Free at console.groq.com

### 1. Clone the Repository

```bash
git clone https://github.com/nhcarrigan-mentorship/matanat-khalilova.git
cd matanat-khalilova
```

### 2. Set Up Environment Variables

```bash
cp .env.example .env
```

Open `.env` and fill in your API keys and configuration values.

### 3. Install Dependencies

To get the full-stack environment ready, you must install dependencies for both the frontend and the backend.

#### Frontend (React)

Navigate to the root directory and run:

```Bash
npm install
```

#### Backend (FastAPI)

Navigate to the `backend` folder, activate your virtual environment and install the Python packages:

```Bash
cd backend
# 1. Create and activate virtual environment
python -m venv venv
.\venv\Scripts\activate      # Windows (PowerShell)
# source venv/bin/activate   # Mac/Linux

# 2. Install requirements
pip install -r requirements.txt
```

### 4. Available Scripts

In the project directory, you can run the following commands:

#### Frontend

| Command                | Description                                                       |
| :--------------------- | :---------------------------------------------------------------- |
| `npm start`            | Runs the app in development mode.                                 |
| `npm run lint`         | Checks code quality and style using ESLint.                       |
| `npm run format`       | **Fixes** code formatting automatically using Prettier.           |
| `npm run format:check` | **Verifies** that the code follows formatting rules (used by CI). |
| `npm run build`        | Builds the app for production.                                    |
| `npm test`             | Runs the audio validation test suite.                             |

#### Backend

| Command                                                            | Description                                                          |
| :----------------------------------------------------------------- | :------------------------------------------------------------------- |
| `uvicorn main:app --reload`                                        | Starts the FastAPI development server.                               |
| `pytest`                                                           | Runs the backend test suite.                                         |
| `black .`                                                          | Formats Python code according to standards.                          |
| `flake8 .`                                                         | Lints the code to check for PEP8 style violations.                   |
| `isort .`                                                          | Sorts imports alphabetically and into logical groups.                |
| `bandit -r .`                                                      | Security scan that checks for common vulnerabilities in Python code. |
| `python -c "import fastapi, torch, groq; print('Environment OK')"` | Environment Check to verify core libraries are correctly installed.  |

### 5. Code Quality Tools

- **JavaScript**: **ESLint 8** is used for linting to ensure clean and consistent code.
- **Python**: **PEP8** standards are adhered to by using a suite of quality tools. **Black** is used for formatting, **isort** for import organization, **Flake8** for linting and **Bandit** for automated security vulnerability scanning. Configuration settings can be found in `pyproject.toml` and `.flake8`.

## Usage

1. Sign up and create your account.
2. Go to **Voice Training** — record your 15 voice samples.
3. Navigate to **Voice Profile** — review your recordings and
   re-record any samples you are not satisfied with.
4. Click **"Train My Voice"** to generate your personalized speech correction profile.
5. Go to **Meeting Sandbox** to start transcribing your speech in real time.
6. Use Single Take or Continuous Mode depending on your needs:
   - **Single Take** — Speak at your own pace, then finalize to receive the full transcription at once.
   - **Continuous** — Live streaming that detects sentences
     automatically as you speak.
7. Review the transcribed text, edit if needed, then click
   **"Speak to Audience"** to broadcast as natural-sounding audio.

## Project Structure

```
voice-bridge/
├── src/                  # React frontend
│   ├── components/       # Modular UI components
│   ├── pages/            # Application view layouts
│   └── utils/            # Frontend audio validation logic
├── public/               # Static assets
│   └── index.html        # Main HTML entry point & Cloudflare analytics setup
├── backend/              # FastAPI backend
│   ├── main.py           # Core API endpoints & VAD processing logic
│   ├── audio_utils.py    # Groq transcription & audio helper functions
│   └── requirements.txt  # Python package dependencies
└── .env.example          # Environment variables configuration template
```

## Contributing

Contributions are not open at this time, but may be welcomed in the future. Stay tuned! 💜

## License

[![MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) — see [LICENSE](LICENSE)

## Contact

Matanat Khalilova — [LinkedIn](https://www.linkedin.com/in/matanatkhalil/)
