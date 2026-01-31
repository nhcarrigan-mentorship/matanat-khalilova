import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Dashboard.css";

const Dashboard = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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
      await fetch("http://localhost:8000/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      setTimeout(() => {
        navigate("/login");
        setLoading(false);
      }, 1000);
    } catch (error) {
      console.error("Logout failed", error); // eslint-disable-line no-console
    }
  };

  return (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <h1>Welcome, {user.name}!</h1>
      <p>Your email: {user.email}</p>
      <button
        onClick={handleLogout}
        className="logout-button"
        aria-label={loading ? "Logging out, please wait" : "Log Out"}
        disabled={loading}
      >
        {loading ? "Logging out..." : "Log Out"}
      </button>
      <button
        onClick={() => navigate("/train")}
        className="train-button"
        aria-label="Go to Voice Training Page"
      >
        Go to Training Page 🎤
      </button>
    </div>
  );
};

export default Dashboard;
