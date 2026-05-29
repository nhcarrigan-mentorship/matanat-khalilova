import React, { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import "./MeetingSandbox.css";

const MeetingSandbox = () => {
  const [isOptimized, setIsOptimized] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [audioUrl, setAudioUrl] = useState(false);
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

  const startRecording = async () => {
    try {
      // Request microphone access with built-in hardware optimization
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      setStatus("Recording...");
      setIsRecording(true);
      setAudioUrl(null); //Reset the player for the new recording
      audioChunksRef.current = []; // Clear previous audio chunks

      // Initialize the MediaRecorder instance with the microphone stream
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder; // Store the instance in the ref

      // Every time audio data becomes available, push it into our ref array
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Start recording
      mediaRecorder.start(200);
    } catch (error) {
      setStatus(
        "Error accessing microphone. Please allow access and try again.",
      );
      console.error("Microphone access error:", error); // eslint-disable-line no-console
    }
  };

  const stopRecording = () => {
    if (!isRecording || !mediaRecorderRef.current) return;
    setStatus("Processing audio...");
    setIsRecording(false);

    // When recording stops, assemble the final binary blob
    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, {
        type: "audio/webm",
      });

      // Safely turn off the microphone hardware light now that the session is finalized
      if (mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream
          .getTracks()
          .forEach((track) => track.stop());
      }

      // Generate a temporary browser playback URL for the audio player
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
          setTranscription(data.text || "No transcription returned.");
          setStatus("Idle");
        } else {
          console.error("Audio processing error:", data); // eslint-disable-line no-console
          setStatus(
            `Error: ${data.error || "Unknown error during transcription."}`,
          );
        }
      } catch (error) {
        setStatus("Network error connecting to transcription pipeline.");
        console.error("Audio processing error regarding API:", error); // eslint-disable-line no-console
      }
    };

    // Stop the MediaRecorder hardware process
    mediaRecorderRef.current.stop();
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
          operational. Translations are now calibrated to your specific vocal
          patterns.
        </div>
      )}
      <p>Status: {status}</p>

      {/* Recording Workspace Layout */}
      <div className="recording-workspace">
        <h3>Press and hold the button to stream or record audio</h3>

        <button
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onTouchStart={startRecording}
          onTouchEnd={stopRecording}
          style={{ backgroundColor: isRecording ? "#dc3545" : "#007bff" }}
        >
          {isRecording
            ? "🔴 Recording... (Release to stop)"
            : "🎤 Hold to Talk"}
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
          <audio src={audioUrl} controls />
        </div>
      )}
    </div>
  );
};

export default MeetingSandbox;
