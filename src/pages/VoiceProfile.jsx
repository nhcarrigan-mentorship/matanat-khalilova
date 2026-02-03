import React, { useEffect, useState } from "react";
import { Play, RotateCcw, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import "./VoiceProfile.css";

const VoiceProfile = () => {
  const [recordings, setRecordings] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {}, []);
  return (
    <div className="profile-container" style={{ padding: "40px" }}>
      <button onClick={() => navigate("/dashboard")} className="back-link">
        <ArrowLeft size={18} /> Back to Dashboard
      </button>

      <h1>Your Voice Profile 🎙️</h1>
      <p>Review or re-record your training samples below.</p>

      <div className="recordings-list">
        {/* 2. We will map through the recordings here */}
      </div>
    </div>
  );
};

export default VoiceProfile;
