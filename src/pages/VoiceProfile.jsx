import React, { useEffect, useState } from "react";
import { Play, ArrowLeft, Pause } from "lucide-react";
import { useNavigate } from "react-router-dom";
import "./VoiceProfile.css";

const VoiceProfile = () => {
  const [recordings, setRecordings] = useState([]);
  const [user, setUser] = useState(null);
  const [isPlaying, setIsPlaying] = useState(null);
  const navigate = useNavigate();

  const handlePlay = (rec) => {
    // If the same recording is clicked, toggle play/pause
    if (isPlaying === rec._id) {
      window.currentAudio?.pause();
      setIsPlaying(null);
      return;
    }

    if (window.currentAudio) {
      window.currentAudio.pause();
    }

    // Create a new audio and play
    const audio = new Audio(rec.audio_url);
    window.currentAudio = audio;
    setIsPlaying(rec._id); // Store it globally/locally to control it

    audio.play();

    // Reset icon when audio ends naturally
    audio.onended = () => {
      setIsPlaying(null);
    };
  };

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch("http://localhost:8000/api/auth/me", {
          method: "GET",
          credentials: "include",
        });
        const data = await response.json();

        if (response.ok) {
          setUser(data.user);
        } else {
          navigate("/login");
        }
      } catch (error) {
        navigate("/login");
      }
    };
    checkAuth();
  }, [navigate]);

  useEffect(() => {
    const fetchRecordings = async () => {
      try {
        const response = await fetch(
          "http://localhost:8000/api/my-recordings",
          {
            method: "GET",
            credentials: "include",
          },
        );
        const data = await response.json();

        if (response.ok && data.status === "success") {
          setRecordings(data.recordings);
        }
      } catch (error) {
        console.error("Error fetching recordings:", error); // eslint-disable-line no-console
      }
    };

    fetchRecordings();
  }, []);

  return (
    <div className="profile-container" style={{ padding: "40px" }}>
      <button onClick={() => navigate("/dashboard")} className="back-link">
        <ArrowLeft size={18} aria-hidden="true" /> Back to Dashboard
      </button>

      <h1>
        {user?.name
          ? `${user.name}'s Voice Profile 🎙️`
          : "Your Voice Profile 🎙️"}
      </h1>
      <p>Review your training samples below.</p>
      <div className="recordings-list">
        {recordings.length === 0 ? (
          <p>No recordings found. Please record your voice samples.</p>
        ) : (
          recordings.map((rec, index) => (
            <div key={rec._id} className="recording-item">
              <span>Recording {index + 1}</span>
              <div>
                <button
                  className="play-button"
                  aria-label={
                    isPlaying === rec._id ? "Pause Recording" : "Play Recording"
                  }
                  onClick={() => handlePlay(rec)}
                >
                  {isPlaying === rec._id ? (
                    <Pause size={16} aria-hidden="true" />
                  ) : (
                    <Play size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default VoiceProfile;
