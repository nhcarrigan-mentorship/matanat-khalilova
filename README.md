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

Install all required packages for the JavaScript environment:

```Bash
npm install
```

### 3. Available Scripts

In the project directory, you can run the following commands:
| Command | Description |
| :--- | :--- |
| `npm start` | Runs the app in development mode. |
| `npm run lint` | Checks code quality and style using ESLint. |
| `npm run format` | **Fixes** code formatting automatically using Prettier. |
| `npm run format:check` | **Verifies** that the code follows formatting rules (used by CI). |
| `npm run build` | Builds the app for production. |
| `npm test` | Runs the test suite (currently set to placeholder). |

### 4. Code Quality Tools

- JavaScript: We use ESLint 8 for linting to ensure clean and consistent code.
- Python: We use Black for uncompromising code formatting. Configuration is located in `pyproject.toml`.
