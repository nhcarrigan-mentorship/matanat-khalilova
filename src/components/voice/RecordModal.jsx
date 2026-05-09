import React, { useEffect, useRef, useState } from "react";
import { Mic, Square, X, Play, Pause, Save, FileAudio2 } from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import "./RecordModal.css";

/*eslint-disable react/prop-types */
const WaveformPlayer = ({ url, isPlaying, onFinish }) => {
  const containerRef = useRef(null);
  const waveSurferRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    // Create the waveform visualizer
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#babdc1",
      progressColor: "#8b5cf6",
      cursorColor: "transparent",
      barWidth: 3,
      barRadius: 3,
      responsive: true,
      height: 40,
      normalize: true,
    });

    waveSurferRef.current = ws;
    ws.load(url).catch((err) => {
      if (err.name !== "AbortError") {
        console.error("WaveSurfer error:", err); // eslint-disable-line no-console
      }
    });

    ws.on("finish", () => {
      onFinish();
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

const RecordModal = ({ sample, onClose, onUpdateSuccess }) => {
  // eslint-disable-next-line
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioURL, setAudioURL] = useState(null);
  const [isUpdated, setIsUpdated] = useState(false);
  const [blob, setBlob] = useState(null);
  const [error, setError] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const recordingStartTimeRef = useRef(null);

  const checkIsSilent = async (blob) => {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new (
      window.AudioContext || window.webkitAudioContext
    )();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const rawData = audioBuffer.getChannelData(0); // Get audio channel data

    let maxAmplitude = 0;
    for (let i = 0; i < rawData.length; i++) {
      if (Math.abs(rawData[i]) > maxAmplitude) {
        maxAmplitude = Math.abs(rawData[i]);
      }
    }

    await audioContext.close();
    // If the loudest point is less than 0.01 (1%), it's basically silent
    return maxAmplitude < 0.01;
  };

  const startRecording = async () => {
    setError(null); // Clear errors when starting fresh
    recordingStartTimeRef.current = Date.now();
    setIsUpdated(false);
    setAudioURL(null);
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
    const startTime = recordingStartTimeRef.current;
    const duration = Date.now() - startTime;

    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
      if (duration < 1500) {
        setError("Recording was too short, please speak the full phrase");
        setAudioURL(null);
        setBlob(null);
        setIsRecording(false);
        return;
      }

      const isSilent = await checkIsSilent(audioBlob);
      if (isSilent) {
        setError("We didn't detect any speech, please try again");
        setAudioURL(null);
        setBlob(null);
        setIsRecording(false);
        return;
      }
      setError(null);
      setBlob(audioBlob);
      const url = URL.createObjectURL(audioBlob);
      setAudioURL(url);
      setIsRecording(false);
    };

    // Stop tracks first
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }

    // this triggers onstop
    mediaRecorderRef.current.stop();
    setIsRecording(false);
  };

  const saveToCloudinary = async (audioBlob) => {
    const formData = new FormData();
    formData.append("file", audioBlob, "recording.wav");
    formData.append("phrase_id", sample._id); // Send phrase ID to backend

    const response = await fetch("http://localhost:8000/api/upload-audio", {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    return await response.json();
  };

  const togglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  const handleUpdate = async () => {
    if (isSaving || isUpdated || !blob) return;
    setIsSaving(true);
    setError(null); // Clear old errors
    try {
      const uploadResult = await saveToCloudinary(blob);
      if (uploadResult && uploadResult.status === "success") {
        if (onUpdateSuccess) {
          await onUpdateSuccess();
        }
        setIsUpdated(true);
      } else {
        setError(uploadResult?.message || "Server error. Please try again.");
      }
    } catch (error) {
      console.error("Update failed", error); // eslint-disable-line no-console
      setError(
        "Upload failed. Please check your internet connection and try again.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="close-button" onClick={onClose}>
          <X size={24} />
        </button>
        <h2>Re-record Sample</h2>
        <p className="phrase-text">
          {sample?.text ? sample.text : "Loading sentence..."}
        </p>
        <div className="recorder-section">
          {!isRecording ? (
            <button onClick={startRecording} className="record-button">
              <Mic size={24} /> {audioURL ? "Try Again" : "Record"}
            </button>
          ) : (
            <button onClick={stopRecording} className="stop-button">
              <Square size={24} />
              Stop
            </button>
          )}
        </div>
        {audioURL && (
          <div className="audio-player-section">
            <div className="audio-info">
              <FileAudio2 size={16} color="#8b5cf6" aria-hidden="true" />
              <span> Review New Recording</span>
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
            <button
              className={`save-button ${isSaving ? "saving" : ""} ${isUpdated ? "success" : ""}`}
              onClick={handleUpdate}
              disabled={isSaving || isUpdated}
            >
              <Save size={18} />
              {isSaving
                ? "Saving..."
                : isUpdated
                  ? "Updated!"
                  : "Update Recording"}
            </button>
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
};

export default RecordModal;
