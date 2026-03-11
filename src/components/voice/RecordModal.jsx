import React, { useRef, useState } from "react";
import { Mic, Square, X, Play, Pause, Save } from "lucide-react";
import "./RecordModal.css";

const RecordModal = ({ sample, onClose }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioURL, setAudioURL] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);

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

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <button className="close-button" onClick={onClose}>
          <X />
        </button>
        <h2>Re-record Sample</h2>
        <p className="phrase-text">{sample.text}</p>
        <div className="recorder-section">
          {!isRecording ? (
            <button onClick={startRecording} className="record-btn">
              <Mic size={24} /> {audioURL ? "Try Again" : "Record"}
            </button>
          ) : (
            <button onClick={stopRecording} className="stop-btn">
              <Square size={24} />
              Stop
            </button>
          )}
        </div>
        {audioURL && (
          <button className="save-btn" onClick={() => console.log("Saving...")}>
            <Save size={18} /> Update Recording
          </button>
        )}
      </div>
    </div>
  );
};

export default RecordModal;
