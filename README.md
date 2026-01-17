# 🎙️ VoiceBridge

Empowering individuals with speech disabilities by transforming atypical speech into clear, effective communication.

## Installation & Setup

Follow these steps to get your local development environment running.

### Prerequisites

- **Node.js**: Version 18.x or higher is required to match our CI environment.
- **npm**: Usually comes bundled with Node.js.
- **Python**: Version 3.11+ (if working on AI/Speech backend logic).

### 1. Clone the Repository

```bash
git clone https://github.com/nhcarrigan-mentorship/matanat-khalilova.git
cd matanat-khalilova
```

### 2. Install Dependencies

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

### 3. Available Scripts

In the project directory, you can run the following commands:

#### Frontend

| Command                | Description                                                       |
| :--------------------- | :---------------------------------------------------------------- |
| `npm start`            | Runs the app in development mode.                                 |
| `npm run lint`         | Checks code quality and style using ESLint.                       |
| `npm run format`       | **Fixes** code formatting automatically using Prettier.           |
| `npm run format:check` | **Verifies** that the code follows formatting rules (used by CI). |
| `npm run build`        | Builds the app for production.                                    |
| `npm test`             | Runs the test suite (currently set to placeholder).               |

#### Backend

| Command                     | Description                                                          |
| :-------------------------- | :------------------------------------------------------------------- |
| `uvicorn main:app --reload` | Starts the FastAPI development server.                               |
| `pytest`                    | Runs the backend test suite.                                         |
| `black .`                   | Formats Python code according to standards.                          |
| `flake8 .`                  | Lints the code to check for PEP8 style violations.                   |
| `isort .`                   | Sorts imports alphabetically and into logical groups.                |
| `bandit -r .`               | Security scan that checks for common vulnerabilities in Python code. |
| `python -c "..."`           | Environment Check to verify core libraries are correctly installed.  |

### 4. Code Quality Tools

- **JavaScript**: We use **ESLint 8** for linting to ensure clean and consistent code.
- **Python**: We adhere to **PEP8** standards by using a suite of quality tools. We use **Black** for formatting, **isort** for import organization, **Flake8** for linting and **Bandit** for automated security vulnerability scanning. Configuration settings can be found in `pyproject.toml` and `.flake8`.
