import React, { useState } from "react";

const MeetingSandbox = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [audioUrl] = useState(null);

  const startRecording = () => {
    setStatus("Recording...");
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (!isRecording) return;
    setStatus("Processing audio...");
    setIsRecording(false);
  };

  return (
    <div>
      <h2>VoiceBridge Sandbox View</h2>
      <p>
        Status: <strong>{status}</strong>
      </p>

      <button
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onTouchStart={startRecording}
        onTouchEnd={stopRecording}
      >
        {isRecording ? "Hold to Speak (Recording...)" : "Press & Hold to Talk"}
      </button>

      {audioUrl && (
        <div style={{ marginTop: "30px" }}>
          <h3>Review Local Recording:</h3>
        </div>
      )}
    </div>
  );
};

export default MeetingSandbox;
