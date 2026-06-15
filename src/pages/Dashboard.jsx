import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clientFetch } from "../apiConfig";
import "./Dashboard.css";

const Dashboard = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await clientFetch("/api/auth/me");

        if (response.ok) {
          const data = await response.json();
          setUser(data.user);
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
    return <div>Loading your dashboard...</div>;
  }

  const handleLogout = async () => {
    setLoading(true);
    try {
      await clientFetch("/api/auth/logout", {
        method: "POST",
      });
      setTimeout(() => {
        localStorage.removeItem("access_token");
        navigate("/login");
        setLoading(false);
      }, 1000);
    } catch (error) {
      console.error("Logout failed", error); // eslint-disable-line no-console
    }
  };

  return (
    <div className="dashboard-container">
      {/* Header Section */}
      <header className="dashboard-header">
        <h1>Welcome, {user.name}!</h1>
        <p>Logged in as: {user.email}</p>
        <button
          onClick={handleLogout}
          className="logout-button"
          aria-label={loading ? "Logging out, please wait" : "Log Out"}
          disabled={loading}
        >
          {loading ? "Logging out..." : "Log Out"}
        </button>
      </header>

      <div className="dashboard-grid">
        {/* Card 1: Profile Setup / Profile View */}
        <div className="action-card">
          {!user.is_trained ? (
            <>
              <h3>Voice Training</h3>
              <p>
                Record sample sentences to analyze your speech patterns and
                calibrate your personalized voice profile.
              </p>
              <button
                onClick={() => navigate("/train")}
                className="train-button"
                aria-label="Go to Voice Training Page"
              >
                Get Started
              </button>
            </>
          ) : (
            <>
              <h3>Voice Profile</h3>
              <p>
                Manage your active voice profile—review, fine-tune, or re-record
                your voice baseline to continually optimize your results.
              </p>
              <button
                onClick={() => navigate("/voice-profile")}
                className="profile-button"
              >
                View My Profile
              </button>
            </>
          )}
        </div>

        {/* Card 2: Sandbox Testing Area */}
        <div className="action-card">
          <h3>Meeting Sandbox</h3>
          <p>
            Stream your audio to test real-time transcription using either
            instant single-burst or hands-free continuous modes.
          </p>
          <button
            onClick={() => navigate("/meeting-sandbox")}
            className="sandbox-button"
          >
            Enter Sandbox
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
