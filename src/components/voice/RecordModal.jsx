import React, { useRef, useState } from "react";
import { Mic, Square, X, Play, Pause, Save, FileAudio2 } from "lucide-react";
import "./RecordModal.css";
import { clientFetch } from "../../apiConfig";
import { validateAudio } from "../../utils/audioValidation";
import WaveformPlayer from "./WaveformPlayer";

/*eslint-disable react/prop-types */
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

  const startRecording = async () => {
    setError(null); // Clear errors when starting fresh
    recordingStartTimeRef.current = Date.now();
    setIsUpdated(false);
    setAudioURL(null);

    try {
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
    } catch (err) {
      console.error("Microphone access error in modal:", err); // eslint-disable-line no-console

      if (
        err.name === "NotAllowedError" ||
        err.name === "PermissionDeniedError"
      ) {
        setError(
          "Mic access denied. Please allow it in your browser settings to record.",
        );
      } else if (
        err.name === "NotFoundError" ||
        err.name === "DevicesNotFoundError"
      ) {
        setError("No microphone found. Please connect a recording device.");
      } else {
        setError(
          "Unable to access your microphone. Please check your system settings.",
        );
      }

      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    setIsRecording(false); // immediately update UI to show we stopped

    const startTime = recordingStartTimeRef.current;
    const duration = Date.now() - startTime;

    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });

      const { isValid, error } = await validateAudio(audioBlob, duration);
      if (!isValid) {
        setError(error);
        setAudioURL(null);
        setBlob(null);
        return;
      }

      setError(null);
      setBlob(audioBlob);
      const url = URL.createObjectURL(audioBlob);
      setAudioURL(url);
    };

    // Stop tracks first
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }

    // this triggers onstop
    mediaRecorderRef.current.stop();
  };

  const saveToCloudinary = async (audioBlob) => {
    const formData = new FormData();
    formData.append("file", audioBlob, "recording.wav");
    formData.append("phrase_id", sample._id); // Send phrase ID to backend

    const response = await clientFetch("/api/upload-audio", {
      method: "POST",
      body: formData,
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
        <button
          className="close-button"
          onClick={onClose}
          aria-label="Close modal"
        >
          <X size={24} aria-hidden="true" />
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
