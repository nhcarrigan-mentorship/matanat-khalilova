import React, { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import "./MeetingSandbox.css";

const MeetingSandbox = () => {
  const [isOptimized, setIsOptimized] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [audioUrl, setAudioUrl] = useState("");
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  const mediaRecorderRef = useRef(null); // Holds the active MediaRecorder instance
  const audioChunksRef = useRef([]); // Holds the raw binary audio array chunks

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
          if (data.user && typeof data.user.is_optimized !== "undefined") {
            setIsOptimized(data.user.is_optimized);
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

  // If user data is not yet loaded, show a loading message
  if (!user) {
    return <div>Loading...</div>;
  }

  const startRecording = async (e) => {
    // Prevent default browser behavior for touch/mouse split events
    if (e && e.preventDefault) e.preventDefault();

    // If we are already initializing or recording, block duplicate triggers
    if (isRecording || mediaRecorderRef.current?.state === "recording") {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Clear old tracks before starting clean
      audioChunksRef.current = [];
      setAudioUrl("");
      setStatus("Recording...");
      setIsRecording(true);

      let options = { mimeType: "audio/webm;codecs=opus" };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = MediaRecorder.isTypeSupported("audio/webm")
          ? { mimeType: "audio/webm" }
          : {};
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          // eslint-disable-next-line no-console
          console.log(
            `Chunk gathered: ${event.data.size} bytes. Total chunks: ${audioChunksRef.current.length}`,
          );
        }
      };

      mediaRecorder.start(250); // Flush hardware buffers every 250ms
    } catch (error) {
      setStatus("Error accessing microphone.");
      console.error("Microphone access error:", error); // eslint-disable-line no-console
      setIsRecording(false);
    }
  };

  const stopRecording = (e) => {
    if (e && e.preventDefault) e.preventDefault();

    // If we aren't actively recording, do nothing
    if (!isRecording || !mediaRecorderRef.current) return;

    setStatus("Processing audio...");
    setIsRecording(false);

    // Arm the handler first to ensure we capture the final chunks before the stream is killed
    mediaRecorderRef.current.onstop = async () => {
      // Turn off microphone hardware stream lights immediately
      if (mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream
          .getTracks()
          .forEach((track) => track.stop());
      }

      console.log("Final chunk assembly count:", audioChunksRef.current.length); // eslint-disable-line no-console

      const finalMimeType = mediaRecorderRef.current.mimeType || "audio/webm";
      const audioBlob = new Blob(audioChunksRef.current, {
        type: finalMimeType,
      });

      console.log("Final Assembled Blob Size:", audioBlob.size, "bytes"); // eslint-disable-line no-console

      if (audioBlob.size === 0) {
        setStatus("Error: Audio chunk array was empty.");
        return;
      }

      const playbackUrl = URL.createObjectURL(audioBlob);
      setAudioUrl(playbackUrl);

      try {
        const formData = new FormData();
        formData.append("audio_file", audioBlob, "recording.webm");

        const response = await fetch(
          "http://localhost:8000/api/translate/instant",
          {
            method: "POST",
            body: formData,
            credentials: "include",
          },
        );

        const data = await response.json();

        if (response.ok) {
          setTranscription(data.corrected_text || "No transcription returned.");
          setStatus("Idle");
        } else {
          setStatus(`Error: ${data.detail || "Unknown backend error."}`);
        }
      } catch (error) {
        setStatus("Network error connecting to transcription pipeline.");
        console.error("API transmission exception:", error); // eslint-disable-line no-console
      }
    };

    // Safely trigger the hardware stop command now that the handler is armed
    if (mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  return (
    <div className="meeting-sandbox">
      <h2>🎙️ VoiceBridge Sandbox View</h2>
      {/* Dynamic info banner based on optimization status */}
      {!isOptimized ? (
        <div className="info-banner-warning">
          <strong>Standard Mode:</strong> You are currently using standard
          Whisper transcription.
          <Link className="link" to="/voice-profile">
            {" "}
            Train your voice profile
          </Link>{" "}
          to optimize your model for better accuracy.
        </div>
      ) : (
        <div className="info-banner-success">
          <strong>Optimized Mode:</strong> Your unique speech mapping is fully
          operational. Transcriptions are now calibrated to your specific vocal
          patterns.
        </div>
      )}
      <p className="workspace-status">
        Status:{" "}
        <span
          className={`status-badge ${status.toLowerCase().replace("...", "").replace(" ", "-")}`}
        >
          {status}
        </span>
      </p>

      {/* Recording Workspace Layout */}
      <div className="recording-workspace">
        <p className="workspace-instruction">
          {isRecording
            ? "Release to finalize and transcribe"
            : "Press and hold to record audio"}
        </p>
        <button
          onMouseDown={(e) => startRecording(e)}
          onMouseUp={(e) => stopRecording(e)}
          onTouchStart={(e) => startRecording(e)}
          onTouchEnd={(e) => stopRecording(e)}
          style={{ backgroundColor: isRecording ? "#dc2626" : "#7c3aed" }}
        >
          <span className="btn-icon">
            {isRecording ? (
              <span className="pulse-indicator" />
            ) : (
              /* Minimalist Microphone SVG */
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mic-svg"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            )}
          </span>
          <span className="btn-text">
            {isRecording
              ? "Listening..."
              : audioUrl
                ? "Re-try"
                : "Hold to Talk"}
          </span>
        </button>

        <div className="transcription-section">
          <h4>Live Output:</h4>
          <textarea
            className="transcription-output"
            cols={60}
            value={transcription}
            placeholder="Your transcribed text will appear here in real-time..."
            rows={5}
            readOnly={isRecording || status === "Processing audio..."} // Lock the field if recording or if the backend is processing audio
            onChange={(e) => setTranscription(e.target.value)}
          />
        </div>
      </div>

      {audioUrl && (
        <div className="audio-review-section">
          <h3>Review Local Recording:</h3>
          <audio
            src={audioUrl}
            controls
            onLoadedMetadata={(e) => {
              // If duration is infinite/unknown, trick the browser into calculating it instantly
              if (e.target.duration === Infinity || isNaN(e.target.duration)) {
                e.target.currentTime = 1e10; // Fast forward to the end
                e.target.onseeked = function () {
                  e.target.currentTime = 0; // Snap right back to the beginning
                  e.target.onseeked = null; // Unbind/kill the listener to avoid a loop
                };
              }
            }}
          />
        </div>
      )}
    </div>
  );
};

export default MeetingSandbox;
