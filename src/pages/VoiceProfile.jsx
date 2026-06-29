import React, { useEffect, useState } from "react";
import {
  Play,
  ArrowLeft,
  Pause,
  RotateCcw,
  Loader2,
  CheckCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import "./VoiceProfile.css";
import RecordModal from "../components/voice/RecordModal.jsx";
import { clientFetch } from "../apiConfig";

const VoiceProfile = () => {
  const [recordings, setRecordings] = useState([]);
  const [user, setUser] = useState(null);
  const [isPlaying, setIsPlaying] = useState(null);
  const [selectedSample, setSelectedSample] = useState(null);
  const [isOptimized, setIsOptimized] = useState(false);
  const [hasPatterns, setHasPatterns] = useState(false);
  const [fetchingStatus, setFetchingStatus] = useState(true); // To handle initial loading blink
  const [loading, setLoading] = useState(false);
  const [trainError, setTrainError] = useState(null);
  const [failedPhrases, setFailedPhrases] = useState([]); // eslint-disable-line no-unused-vars
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
        const response = await clientFetch("/api/auth/me");
        const data = await response.json();

        if (response.ok) {
          setUser(data.user);
          if (
            data.user &&
            typeof data.user.is_trained !== "undefined" &&
            data.user.is_trained !== true
          ) {
            navigate("/train", {
              replace: true, // Replaces the profile URL in history so they don't get stuck in a back-button loop
              state: {
                message:
                  "Complete all 15 speech recordings to unlock your Voice Profile view!",
              },
            });
          }
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
    const fetchProfileStatus = async () => {
      try {
        // Fetch status from Backend API
        const response = await clientFetch("/api/voice-profile/status");
        const data = await response.json();
        // Sync the state with the database truth
        if (response.ok) {
          setIsOptimized(data.is_optimized);
          setHasPatterns(data.has_patterns || false); // Default to false if not provided
        }
      } catch (error) {
        console.error("Error fetching profile status:", error); // eslint-disable-line no-console
      } finally {
        setFetchingStatus(false);
      }
    };

    fetchProfileStatus();
  }, []);

  const fetchRecordings = async () => {
    try {
      const response = await clientFetch("/api/my-recordings");
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

  const handleTrainProfile = async () => {
    if (recordings.length < 15) return; // Safeguard client-side

    setIsPlaying(null); // Stop any playing audio
    window.currentAudio?.pause();
    setLoading(true);
    setTrainError(null); // Clear any previous training errors before starting
    setFailedPhrases([]); // Clear previous failed recording highlights
    try {
      const response = await clientFetch("/api/train-profile", {
        method: "POST",
      });
      const resPayload = await response.json();

      // Handle HTTP errors (like the 400 Bad Request for low quality)
      if (!response.ok) {
        const detail = resPayload.detail;
        let baseError = "Training failed. Please try again.";
        let extractedIds = [];

        // Parse detail safely whether it is an object, a JSON string or a plain string
        if (detail) {
          if (typeof detail === "object") {
            baseError = detail.message || baseError;
            extractedIds = detail.failed_ids || [];
          } else {
            try {
              const parsed = JSON.parse(detail);
              baseError = parsed.message || baseError;
              extractedIds = parsed.failed_ids || [];
            } catch (e) {
              baseError = detail; // It was just a plain text string error
            }
          }
        }

        setFailedPhrases(extractedIds);

        const finalMessage = (
          <>
            <div>{baseError}</div>

            {extractedIds.length > 0 && (
              <div
                style={{
                  marginTop: "0.4rem",
                  fontWeight: "600",
                  color: "#991b1b",
                }}
              >
                Failed Recordings: {extractedIds.join(", ")}
              </div>
            )}

            {isOptimized && (
              <span
                style={{
                  display: "block",
                  marginTop: "0.5rem",
                  fontSize: "0.95rem",
                  fontStyle: "italic",
                  opacity: 0.85,
                }}
              >
                {
                  "Don't worry—we're keeping your previous voice profile active so your transcriptions stay accurate."
                }
              </span>
            )}
          </>
        );

        setTrainError(finalMessage);
        return;
      }

      // Handle successful case
      if (resPayload.status === "success") {
        setIsOptimized(true);
        setHasPatterns(resPayload.data.has_patterns); // Update pattern status based on training results
        setFailedPhrases([]); // Explicitly clean up on success
      }
    } catch (error) {
      console.error("Error training voice profile:", error); // eslint-disable-line no-console
      setTrainError(
        "A network error occurred while compiling your voice profile. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  if (fetchingStatus) {
    return (
      <div className="loading-container">
        <p>Loading your profile settings...</p>
      </div>
    );
  }

  return (
    <div className="profile-container" style={{ padding: "2.5rem" }}>
      <button onClick={() => navigate("/dashboard")} className="back-link">
        <ArrowLeft size={18} aria-hidden="true" /> Back to Dashboard
      </button>

      <h1>
        {user?.name ? `${user.name}'s Voice Profile` : "Your Voice Profile"}
      </h1>
      <p>
        Review your samples below or re-record any if you would like to improve
        the accuracy.
      </p>
      {/* UI Success Status Notification */}
      {/* This wrapper stays in the DOM so assistive tech is always listening for updates */}
      <div aria-live="polite" aria-atomic="true">
        {isOptimized && (
          <div className="optimization-banner">
            <CheckCircle size={24} aria-hidden="true" />
            <div>
              {hasPatterns ? (
                // State A: Variations/Distortions detected and mapped
                <p className="optimization-banner-text">
                  <strong>Profile Fully Optimized!</strong>
                  <br />
                  VoiceBridge has built a custom speech correction matrix to map
                  and optimize your unique vocal patterns.
                </p>
              ) : (
                // State B: All 15 recordings matched raw text perfectly
                <p className="optimization-banner-text">
                  <strong>Profile Optimized with Natural Clarity!</strong>
                  <br />
                  Your training recordings match perfectly. VoiceBridge has
                  calibrated your profile to run fast direct-transcription.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
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
      <div className="training-control-card">
        <div className="card-meta">
          <h3>Ready to optimize VoiceBridge?</h3>
          <p>
            We will analyze your 15 audio samples to build your custom speech
            calibration matrix.
          </p>
        </div>
        <button
          className="train-voice-button"
          onClick={handleTrainProfile}
          disabled={loading || recordings.length < 15}
          style={{
            opacity: loading || recordings.length < 15 ? 0.6 : 1,
            cursor:
              loading || recordings.length < 15 ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              Training in Progress...
            </>
          ) : isOptimized ? (
            "Retrain My Voice"
          ) : (
            "Train My Voice"
          )}
        </button>
      </div>

      {trainError && (
        <div
          className="training-error-alert"
          role="alert"
          style={{
            backgroundColor: "#fef2f2",
            border: "1px solid #fca5a5",
            color: "#991b1b",
            padding: "0.75rem",
            borderRadius: "0.375rem",
            marginBottom: "0.95rem",
            marginTop: "1.5rem",
            fontSize: "1rem",
            lineHeight: "1.5",
          }}
        >
          ⚠️ <strong style={{ fontSize: "1.1rem" }}>Calibration Note:</strong>{" "}
          {trainError}
        </div>
      )}

      {recordings.length < 15 && (
        <p style={{ color: "#ce0b0b", fontSize: "1rem", marginTop: "0.5rem" }}>
          * You need exactly 15 recordings to unlock profile training. (Current:{" "}
          {recordings.length}/15)
        </p>
      )}
    </div>
  );
};

export default VoiceProfile;
