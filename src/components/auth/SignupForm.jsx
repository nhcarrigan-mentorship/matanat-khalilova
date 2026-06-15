import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./SignupForm.css";
import { clientFetch } from "../../apiConfig";
import Logo from "../Logo";

const SignupForm = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: "",
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

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(formData.email)) {
      setError("Please enter a valid email address.");
      return;
    }

    const hasNumber = /\d/.test(formData.password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(formData.password);

    if (!hasNumber || !hasSpecialChar) {
      setError(
        "Password must include at least one number and one special character.",
      );
      return;
    }

    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    setError("");
    setLoading(true);

    try {
      const response = await clientFetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });
      const data = await response.json();

      if (response.ok) {
        setFormData({ name: "", email: "", password: "" });
        navigate("/dashboard");
      } else {
        setError(data.detail || "Signup failed. Please try again.");
      }
    } catch (error) {
      setError("Cannot connect to the server. is the Backend running?");
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
          // Not authenticated, stay on signup page
        }
      } catch (error) {
        // Error occurred, stay on signup page;
      }
    };
    checkAuth();
  }, [navigate]);

  return (
    <div className="form-container">
      <div className="auth-brand-side">
        <div className="brand-content">
          {/* Using Logo component here in pure white */}
          <Logo color="#ffffff" className="brand-large-logo" />
          <h1>VoiceBridge</h1>
          <p>Your voice, understood.</p>
        </div>
      </div>
      <div className="auth-form-side">
        <form onSubmit={handleSubmit}>
          {/* Brand header */}
          <div className="auth-header">
            <Logo color="#a855f7" className="auth-logo" />{" "}
            <h2>Join VoiceBridge</h2>
          </div>

          <label htmlFor="name">Full Name:</label>
          <input
            type="text"
            id="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Enter your name"
            required
          />

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
            className="signup-button"
            disabled={loading}
            aria-label={
              loading ? "Creating your account, please wait" : "Sign Up"
            }
          >
            {loading ? "Creating account..." : "Sign Up"}
          </button>
          <p>
            Already have an account?{" "}
            <Link to="/login" className="auth-link">
              Log in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default SignupForm;
