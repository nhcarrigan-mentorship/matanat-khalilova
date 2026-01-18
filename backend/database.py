import os

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

# Get the URL from your .env file
MONGODB_URL = os.getenv("MONGODB_URL")

# Connect to the MongoDB Cluster
client = AsyncIOMotorClient(MONGODB_URL)

# Create a database named 'voicebridge_db'
db = client.voicebridge_db

# Create a collection for users
users_collection = db.users


async def check_connection():
    try:
        # The 'ping' command is cheap and confirms the connection is alive
        await client.admin.command("ping")
        print("✅ Successfully connected to MongoDB Atlas!")
    except Exception as e:
        print(f"❌ Could not connect to MongoDB: {e}")
