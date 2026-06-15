import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./LoginForm.css";
import { clientFetch } from "../../apiConfig";
import Logo from "../Logo";

const LoginForm = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.id]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");
    setLoading(true);
    try {
      const response = await clientFetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });
      const data = await response.json();

      if (response.ok) {
        navigate("/dashboard");
      } else {
        setError(data.detail || "Login failed. Please try again.");
      }
    } catch (error) {
      setError("An error occurred. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await clientFetch("/api/auth/me");

        if (response.ok) {
          navigate("/dashboard");
        } else {
          // Not authenticated, stay on login page
        }
      } catch (error) {
        // Error occurred, stay on login page;
      }
    };
    checkAuth();
  }, [navigate]);

  return (
    <div className="form-container">
      <div className="auth-brand-side">
        <div className="brand-content">
          <Logo color="#ffffff" className="brand-large-logo" />
          <h1>VoiceBridge</h1>
          <p>Your voice, understood.</p>
        </div>
      </div>
      <div className="auth-form-side">
        <form onSubmit={handleSubmit}>
          <div className="auth-header">
            <Logo color="#a855f7" className="auth-logo" /> <h2>Welcome back</h2>
          </div>
          <label htmlFor="email">Email:</label>
          <input
            type="email"
            id="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="email@example.com"
            required
          />
          <label htmlFor="password">Password:</label>
          <input
            type="password"
            id="password"
            value={formData.password}
            onChange={handleChange}
            placeholder="Min 8 characters"
            required
          />
          {error && (
            <p style={{ color: "#dc2626", marginBottom: "0.5rem" }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="signup-button"
            aria-label={loading ? "Logging in, please wait" : "Log In"}
          >
            {loading ? "Logging in..." : "Log In"}
          </button>
          <p>
            New to VoiceBridge?{" "}
            <Link to="/signup" className="auth-link">
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default LoginForm;
