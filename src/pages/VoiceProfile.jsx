import React, { useEffect, useState } from "react";
import { Play, ArrowLeft, Pause, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import "./VoiceProfile.css";
import RecordModal from "../components/voice/RecordModal.jsx";

const VoiceProfile = () => {
  const [recordings, setRecordings] = useState([]);
  const [user, setUser] = useState(null);
  const [isPlaying, setIsPlaying] = useState(null);
  const [selectedSample, setSelectedSample] = useState(null);
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
    const freshUrl = `${rec.audio_url}?t=${new Date().getTime()}`;
    const audio = new Audio(freshUrl);
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

  const fetchRecordings = async () => {
    try {
      const response = await fetch("http://localhost:8000/api/my-recordings", {
        method: "GET",
        credentials: "include",
      });
      const data = await response.json();

      if (response.ok && data.status === "success") {
        setRecordings(data.recordings);
      }
    } catch (error) {
      console.error("Error fetching recordings:", error); // eslint-disable-line no-console
    }
  };

  useEffect(() => {
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
      <p>
        Review your samples below or re-record any if you would like to improve
        the accuracy.
      </p>
      <div className="recordings-list">
        {recordings.length === 0 ? (
          <div className="no-recordings-container">
            <p className="no-recordings-message">
              No recordings found. It looks like you have not started training
              yet!
            </p>
            <button
              onClick={() => navigate("/train")}
              className="train-button-link"
              aria-label="Go to Voice Training Page"
            >
              Go to Training Page
            </button>
          </div>
        ) : (
          recordings.map((rec, index) => (
            <div key={rec.phrase_id} className="recording-item">
              <span>Recording {index + 1}</span>
              <div className="buttons-list">
                <button
                  className="play-button"
                  title="Listen"
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
                <button
                  className="replay-button"
                  title="Re-record"
                  aria-label="Re-record the audio"
                  onClick={() => {
                    setSelectedSample({
                      ...rec,
                      _id: rec.phrase_id,
                      text: rec.text,
                    });
                  }}
                >
                  <RotateCcw size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      {selectedSample && (
        <RecordModal
          sample={selectedSample}
          onClose={() => setSelectedSample(null)}
          onUpdateSuccess={fetchRecordings}
        />
      )}
    </div>
  );
};

export default VoiceProfile;
