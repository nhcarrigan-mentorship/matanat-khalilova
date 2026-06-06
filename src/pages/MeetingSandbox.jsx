import React, { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import "./MeetingSandbox.css";

const MeetingSandbox = () => {
  const [isOptimized, setIsOptimized] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [audioUrl, setAudioUrl] = useState("");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [isStreamingMode, setIsStreamingMode] = useState(false);
  const socketRef = useRef(null);
  const textareaRef = useRef(null);
  const recordingStartTimeRef = useRef(0);

  const mediaRecorderRef = useRef(null); // Holds the active MediaRecorder instance
  const audioChunksRef = useRef([]); // Holds the raw binary audio array chunks
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const localStreamRef = useRef(null);

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

  useEffect(() => {
    if (textareaRef.current) {
      // Take the top position of our view window, and push it down by
      // the exact total height of the entire text body
      // Force the element's internal scroll position to equal its maximum content height
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [transcription]); // Fires instantly every time new text lands

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

      // Capture the exact millisecond recording started
      recordingStartTimeRef.current = Date.now();

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

    // Calculate time passed. If it's under 300ms, ignore this ghost event
    const timeElapsed = Date.now() - recordingStartTimeRef.current;
    if (timeElapsed < 300) {
      // eslint-disable-next-line no-console
      console.warn(
        `Ignored rapid stopRecording ghost event. Elapsed: ${timeElapsed}ms`,
      );
      return;
    }

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

  // Standalone helper to handle all hardware disposal safely and keep the code DRY
  const cleanupHardwareResources = async () => {
    // 1. Turn off the microphone hardware tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    // Fallback check just in case consecutive mode used the mediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.stream) {
      mediaRecorderRef.current.stream
        .getTracks()
        .forEach((track) => track.stop());
      mediaRecorderRef.current = null;
    }

    // 2. Disconnect and clear the processor node
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // 3. Close the AudioContext pipeline safely
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== "closed") {
        await audioContextRef.current.close();
      }
      audioContextRef.current = null;
    }
  };

  const startContinuousStreaming = async () => {
    if (isTransitioning) return;

    setTranscription("");
    setAudioUrl(null);

    setIsTransitioning(true); // Lock the button during initialization phase
    setStatus("Connecting to live stream...");

    // Initialize AudioContext synchronously right on user gesture click
    // to avoid strict browser security suspension policies
    const audioContext = new (window.AudioContext || window.webkitAudioContext)(
      {
        sampleRate: 16000,
      },
    );
    audioContextRef.current = audioContext;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStreamRef.current = stream;

      // Create the native browser WebSocket connection
      const ws = new WebSocket("ws://localhost:8000/api/stream");
      socketRef.current = ws;

      ws.onopen = async () => {
        // Wrapped in a micro try/catch to intercept async promise failures
        try {
          setStatus("Streaming Mode Active");
          setIsTransitioning(false); // Unlock now - the button is a safe "Finish" toggle
          setIsStreamingMode(true);
          // eslint-disable-next-line no-console
          console.log(
            "Frontend connected to WebSocket successfully. Starting PCM audio stream...",
          );

          // Force-resume context to guarantee processing node starts running
          if (audioContext.state === "suspended") {
            await audioContext.resume();
          }

          const source = audioContext.createMediaStreamSource(stream);

          // Create a script processor to capture raw 32-bit floating point PCM nodes
          const processor = audioContext.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;

          source.connect(processor);
          processor.connect(audioContext.destination);

          // Store the stream on a ref so stopContinuousStreaming can access its tracks
          mediaRecorderRef.current = { stream };

          processor.onaudioprocess = (e) => {
            if (ws.readyState === WebSocket.OPEN) {
              // Grab the raw numeric float32 sound wave channel data
              const leftChannel = e.inputBuffer.getChannelData(0);

              // Send the pure raw numbers directly down the pipe (No WebM/FFmpeg containers)
              ws.send(leftChannel);
            }
          };
        } catch (audioGraphError) {
          // eslint-disable-next-line no-console
          console.error(
            "Failed to compile audio processing graph:",
            audioGraphError,
          );
          setStatus("Audio initialization failed.");
          ws.close(); // Triggers ws.onclose below to clean up resources cleanly
        }
      };

      ws.onmessage = (event) => {
        if (event.data === "SYSTEM:AUTO_STOP") {
          // eslint-disable-next-line no-console
          console.log("Received auto-stop from server due to silence");
          stopContinuousStreaming(); // Safely shuts down the mic hardware too
          return;
        }
        console.log("Received message from backend socket:", event.data); // eslint-disable-line no-console
        setTranscription((prev) => prev + "\n" + event.data);
      };

      ws.onerror = async (error) => {
        console.error("WebSocket error observed:", error); // eslint-disable-line no-console
        setStatus("Streaming connection error.");
        setIsTransitioning(false); // Make sure to unlock if the connection fails
        setIsStreamingMode(false); // Protect the UI layout if connection drops abruptly
        await cleanupHardwareResources();
      };

      ws.onclose = async () => {
        console.log("WebSocket bridge closed safely."); // eslint-disable-line no-console
        await cleanupHardwareResources();
        setStatus("Idle");
        setIsTransitioning(false); // Unlock for the next session
        setIsStreamingMode(false);
      };
    } catch (error) {
      setStatus("Error accessing microphone.");
      console.error("Streaming setup failed:", error); // eslint-disable-line no-console

      // Use central cleaner to guarantee both the context and
      // the microphone tracks are completely killed if a mid-setup crash happens
      await cleanupHardwareResources();

      setIsTransitioning(false); // Unlock on error
      setIsStreamingMode(false);
    }
  };

  const stopContinuousStreaming = async () => {
    // Guard clause allows breaking a pending connection loop while initialization happens
    if (!localStreamRef.current && !socketRef.current) return;

    setIsTransitioning(true); // Lock the button while winding down hardware
    setStatus("Disconnecting cleanly...");

    // Turn off and clear all audio nodes/hardware tracks
    await cleanupHardwareResources();

    // Close the WebSocket connection
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    } else {
      // Fallback UI reset block if no socket is active to trigger the ws.onclose event
      setStatus("Idle");
      setIsTransitioning(false);
      setIsStreamingMode(false);
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
        {/* Mode 1: Consecutive Bursts (HTTP POST) */}
        <div className="mode-container" style={{ marginBottom: "2rem" }}>
          <p className="workspace-instruction">
            {isRecording
              ? "Release to finalize"
              : "Mode A: Single Burst Speech (Instant)"}
          </p>
          <button
            className="recording-trigger-btn btn-mode-a"
            disabled={isStreamingMode || status === "Processing audio..."} // lock this button if streaming mode is on
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
        </div>

        {/* Mode 2: Continuous Streaming (WebSockets) */}
        <div
          className="mode-container"
          style={{
            marginBottom: "2rem",
            borderTop: "1px dashed #ccc",
            paddingTop: "1.5rem",
          }}
        >
          <p className="workspace-instruction">
            {isStreamingMode
              ? "Continuous mode is active. Speak freely..."
              : "Mode B: Continuous Streaming Speech (Hands-Free)"}
          </p>
          {!isStreamingMode ? (
            <button
              className="recording-trigger-btn btn-mode-b-start"
              disabled={
                isRecording ||
                isTransitioning ||
                status === "Processing audio..."
              } // Lock if push-to-talk is active
              onClick={startContinuousStreaming}
              style={{
                backgroundColor: "#097d58",
              }}
            >
              <span className="btn-icon">
                {/* Sleek Minimalist Radio/Signal Tower SVG */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mic-svg"
                  style={{
                    width: "1.125rem",
                    height: "1.125rem",
                    marginRight: "0.5rem",
                    verticalAlign: "middle",
                  }}
                >
                  <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9M19.1 4.9c3.9 3.9 3.9 10.3 0 14.2M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5M12 12h.01" />
                </svg>
              </span>
              <span className="btn-text" style={{ verticalAlign: "middle" }}>
                Start Continuous Mode
              </span>
            </button>
          ) : (
            <button
              className="recording-trigger-btn btn-mode-b-stop"
              onClick={stopContinuousStreaming}
              style={{ backgroundColor: "#dc2626" }}
            >
              <span className="btn-icon">
                {/* Sleek Minimalist Stop Square SVG */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mic-svg"
                  style={{
                    width: "1.125rem",
                    height: "1.125rem",
                    marginRight: "0.5rem",
                    verticalAlign: "middle",
                  }}
                >
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              </span>
              <span className="btn-text" style={{ verticalAlign: "middle" }}>
                Finish & Stop Stream
              </span>
            </button>
          )}
        </div>

        <div className="transcription-section">
          <h3 id="transcribed-text-output">Live Output:</h3>
          <textarea
            className="transcription-output"
            ref={textareaRef}
            cols={60}
            value={transcription}
            placeholder="Your transcribed text will appear here in real-time..."
            rows={7}
            readOnly={
              isRecording || status === "Processing audio..." || isStreamingMode
            } // Lock the field if recording or if the backend is processing audio
            onChange={(e) => setTranscription(e.target.value)}
            aria-labelledby="transcribed-text-output"
          />
        </div>
      </div>

      {audioUrl && (
        <div className="audio-review-section">
          <h3 id="audio-review-title">Review Local Recording:</h3>
          <audio
            src={audioUrl}
            controls
            aria-labelledby="audio-review-title"
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
