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
  const audioPlayerRef = useRef(null);
  const navigate = useNavigate();

  const togglePlay = () => {
    // We check if the player exists prior to trying to use it
    if (audioPlayerRef.current) {
      if (isPlaying) {
        audioPlayerRef.current.pause();
      } else {
        audioPlayerRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

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
  /*eslint-disable react/prop-types */
  const WaveformPlayer = ({ url }) => {
    const containerRef = useRef(null);
    const waveSurferRef = useRef(null);

    useEffect(() => {
      // Create the waveform visualizer
      waveSurferRef.current = WaveSurfer.create({
        container: containerRef.current,
        waveColor: "#d1d5db", // Light grey for the "background" waves
        progressColor: "#8b5cf6", // Your purple for the "played" part
        cursorColor: "transparent",
        barWidth: 3, // Makes it look like "bars" (WhatsApp style)
        barRadius: 3,
        responsive: true,
        height: 40,
        normalize: true, // Makes quiet recordings look better
      });

      waveSurferRef.current.load(url);

      return () => waveSurferRef.current.destroy();
    }, [url]);

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
        }
      } catch (error) {
        console.error("Failed to fetch user data", error); // eslint-disable-line no-console
      }
    };
    fetchUser();
  }, []);

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
            <p>
              Phrase {phraseIndex + 1} of {phrases.length}
            </p>
            <p>{phrases[phraseIndex].text}</p>
          </div>
          {audioURL && (
            <div className="mini-audio-bar">
              <div className="waveform-container">
                <WaveformPlayer
                  url={audioURL}
                  isPlaying={isPlaying}
                  onFinish={() => setIsPlaying(false)}
                />
              </div>
              <div className="audio-info">
                <FileAudio2 size={16} color="#8b5cf6" aria-hidden="true" />
                <span>Review Recording {phraseIndex + 1}</span>
              </div>
              <button
                onClick={togglePlay}
                className="icon-only-playback"
                aria-label={isPlaying ? "Pause recording" : "Play recording"}
              >
                {isPlaying ? (
                  <Pause size={18} aria-hidden="true" />
                ) : (
                  <Play size={18} aria-hidden="true" />
                )}
              </button>
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
