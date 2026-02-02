import React, { useRef } from "react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import WaveSurfer from "wavesurfer.js";
import {
  Mic,
  Square,
  ArrowRight,
  LayoutDashboard,
  CheckCircle2,
  FileAudio2,
  Pause,
  Play,
} from "lucide-react";
import "./Train.css";

const Train = () => {
  const [phrases, setPhrases] = useState(null);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [user, setUser] = useState(null);
  const [isFinished, setIsFinished] = useState(false);
  const [audioURL, setAudioURL] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const navigate = useNavigate();

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    mediaRecorderRef.current = new MediaRecorder(stream);
    audioChunksRef.current = [];
    mediaRecorderRef.current.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };
    mediaRecorderRef.current.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    mediaRecorderRef.current.stop();
    setIsRecording(false);
    mediaRecorderRef.current.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
      const url = URL.createObjectURL(audioBlob);
      setAudioURL(url);
      streamRef.current.getTracks().forEach((track) => track.stop());
    };
  };

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  /*eslint-disable react/prop-types */
  const WaveformPlayer = ({ url, isPlaying, onFinish }) => {
    const containerRef = useRef(null);
    const waveSurferRef = useRef(null);

    useEffect(() => {
      if (!containerRef.current) return;
      // Create the waveform visualizer
      const ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: "#babdc1", // Light grey for the background waves
        progressColor: "#8b5cf6", // Purple for the played part
        cursorColor: "transparent",
        barWidth: 3, // Make it look like bars
        barRadius: 3,
        responsive: true,
        height: 40,
        normalize: true, // Make quiet recordings look better
      });

      waveSurferRef.current = ws;
      ws.load(url).catch((err) => {
        if (err.name !== "AbortError") {
          console.error("WaveSurfer error:", err); // eslint-disable-line no-console
        }
      });

      ws.on("finish", () => {
        onFinish(); // Start listening
      });

      return () => {
        ws.un("finish"); // Stop listening (remove the ear)
        ws.destroy(); // Delete the whole player
      };
    }, [url, onFinish]);

    useEffect(() => {
      if (waveSurferRef.current) {
        if (isPlaying) {
          waveSurferRef.current.play();
        } else {
          waveSurferRef.current.pause();
        }
      }
    }, [isPlaying]);

    return (
      <div ref={containerRef} style={{ width: "100%", cursor: "pointer" }} />
    );
  };

  const handleNext = () => {
    setPhraseIndex((prevIndex) =>
      prevIndex + 1 < phrases.length ? prevIndex + 1 : 0,
    );
    setAudioURL(null);
  };

  useEffect(() => {
    const fetchUser = async () => {
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
        console.error("Failed to fetch user data", error); // eslint-disable-line no-console
      }
    };
    fetchUser();
  }, [navigate]);

  const handleFinish = () => {
    setIsFinished(true);
  };

  useEffect(() => {
    const fetchPhrases = async () => {
      try {
        const response = await fetch("http://localhost:8000/api/phrases", {
          method: "GET",
          credentials: "include",
        });
        const data = await response.json();
        if (response.ok) {
          setPhrases(data.phrases);
        } else {
          console.error("Failed to fetch phrases", data.message); // eslint-disable-line no-console
        }
      } catch (error) {
        console.error("Failed to fetch phrases", error); // eslint-disable-line no-console
      }
    };
    fetchPhrases();
  }, []);

  if (!phrases) {
    return <div>Loading phrases...</div>;
  }

  return (
    <div className="train-container" aria-live="polite">
      {isFinished ? (
        <div className="success-message" role="alert">
          <div className="icon-celebration">
            <CheckCircle2
              size={77}
              strokeWidth={1.5}
              color="#8b5cf6"
              aria-hidden="true"
            />
          </div>
          <h2>Fantastic work, {user ? user.name : "there"}!</h2>
          <p>Training complete.</p>
          <p>All recordings saved successfully.</p>
          <button
            onClick={() => navigate("/dashboard")}
            className="dashboard-button"
          >
            <LayoutDashboard size={18} aria-hidden="true" />
            <span>Back to Dashboard</span>
          </button>
        </div>
      ) : (
        <div className="training-interface">
          <h1>Training Phrases</h1>
          <p className="instructions">
            Record each phrase to personalize your voice model.
          </p>
          <div className="phrase-box">
            <div className="phrase-status">
              <span>Step</span>
              <span className="current-step">
                {phraseIndex + 1} / {phrases.length}
              </span>
            </div>
            <p className="phrase-text">{phrases[phraseIndex].text}</p>
          </div>
          {audioURL && (
            <div className="audio-player-section">
              <div className="audio-info">
                <FileAudio2 size={16} color="#8b5cf6" aria-hidden="true" />
                <span> Review Recording {phraseIndex + 1}</span>
              </div>
              <div className="pill-player-container">
                <button
                  onClick={togglePlay}
                  className="pill-play-button"
                  aria-label={isPlaying ? "Pause recording" : "Play recording"}
                >
                  {isPlaying ? (
                    <Pause size={18} aria-hidden="true" fill="currentColor" />
                  ) : (
                    <Play
                      size={18}
                      aria-hidden="true"
                      fill="currentColor"
                      ml="0.125rem"
                    />
                  )}
                </button>
                <div className="pill-waveform-wrapper">
                  <WaveformPlayer
                    url={audioURL}
                    isPlaying={isPlaying}
                    onFinish={() => setIsPlaying(false)}
                  />
                </div>
              </div>
            </div>
          )}
          <div className="controls-group">
            {!isRecording ? (
              <button className="record-button" onClick={startRecording}>
                <Mic size={18} strokeWidth={2.5} aria-hidden="true" />
                {audioURL ? "Retry" : "Record"}
              </button>
            ) : (
              <button className="stop-button" onClick={stopRecording}>
                <Square size={18} fill="currentColor" aria-hidden="true" /> Stop
              </button>
            )}
            <button
              disabled={!audioURL || isRecording}
              onClick={
                phraseIndex === phrases.length - 1 ? handleFinish : handleNext
              }
              className="next-button"
            >
              {phraseIndex === phrases.length - 1 ? (
                <span>
                  Complete <CheckCircle2 size={18} aria-hidden="true" />
                </span>
              ) : (
                <span>
                  Next <ArrowRight size={18} aria-hidden="true" />
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Train;
